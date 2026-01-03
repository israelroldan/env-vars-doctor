/**
 * Sync command - Create or update .env.local files
 *
 * Strategy:
 * - Schema: root .env.local.example defines which variables are shared
 * - Values: written to EACH app's .env.local (Next.js only loads from app dir)
 * - Prompting: if a shared var exists in ANY app, use that value (don't re-prompt)
 * - This ensures: prompt once, distribute to all apps that need it
 */

import * as fs from 'node:fs'
import type {
  EnvDoctorConfig,
  AppInfo,
  EnvVarDefinition,
  ResolverContext,
  ReconciliationResult,
} from '../core/types.js'
import {
  scanWorkspaces,
  getRootEnvPaths,
  hasEnvExample,
  detectCurrentWorkspace,
  findWorkspace,
} from '../core/scanner.js'
import {
  parseEnvLocal,
  parseEnvExample,
  updateEnvLocalContent,
} from '../core/parser.js'
import {
  applyUpdates,
  getAppSchema,
  compareSchemaToActual,
} from '../core/reconciler.js'
import { resolveValue } from '../sources/index.js'
import { getValueSources } from '../plugins/registry.js'
import { executeBeforeSyncHooks, executeAfterSyncHooks } from '../plugins/registry.js'
import * as reporter from '../core/reporter.js'

interface SyncOptions {
  app?: string
  all?: boolean
  verbose?: boolean
  force?: boolean
  rootDir: string
  config: Required<EnvDoctorConfig>
}

/**
 * Compute the canonical shared values (most common value across all apps)
 * This is used to detect overrides - when an app has a different value
 */
function computeCanonicalSharedValues(
  sharedVarNames: Set<string>,
  apps: AppInfo[]
): Map<string, string> {
  // For each shared variable, count occurrences of each value
  const valueCounts = new Map<string, Map<string, number>>()

  for (const varName of sharedVarNames) {
    valueCounts.set(varName, new Map())
  }

  for (const app of apps) {
    const appEnvLocal = parseEnvLocal(app.envLocalPath)
    for (const varName of sharedVarNames) {
      const value = appEnvLocal.values.get(varName)
      if (value) {
        const counts = valueCounts.get(varName)!
        counts.set(value, (counts.get(value) || 0) + 1)
      }
    }
  }

  // Pick the most common value for each variable
  const canonicalValues = new Map<string, string>()
  for (const [varName, counts] of valueCounts) {
    let maxCount = 0
    let mostCommonValue = ''
    for (const [value, count] of counts) {
      if (count > maxCount) {
        maxCount = count
        mostCommonValue = value
      }
    }
    if (mostCommonValue) {
      canonicalValues.set(varName, mostCommonValue)
    }
  }

  return canonicalValues
}

/**
 * Resolve shared variables once upfront
 * Returns a map of resolved values for shared variables
 *
 * Strategy:
 * - Schema: root .env.local.example defines which variables are shared
 * - Values: written to EACH app's .env.local (Next.js only loads from app dir)
 * - Prompting: if a shared var exists in ANY app, use that value (don't re-prompt)
 * - This ensures: prompt once, distribute to all apps that need it
 */
async function resolveSharedVariables(
  rootSchema: EnvVarDefinition[],
  apps: AppInfo[],
  options: {
    interactive: boolean
    verbose?: boolean
    rootDir: string
    config: Required<EnvDoctorConfig>
  }
): Promise<{
  resolvedShared: Map<string, string>
  sharedAdded: number
  sharedSkipped: number
  warnings: string[]
}> {
  const { interactive, verbose, rootDir, config } = options
  const resolvedShared = new Map<string, string>()
  const warnings: string[] = []
  let sharedAdded = 0
  let sharedSkipped = 0

  // Collect existing values from ALL apps
  // If a shared variable exists in ANY app, we'll use that value
  // (avoids re-prompting when some apps already have it configured)
  const existingValues = new Map<string, string>()
  for (const app of apps) {
    const appEnvLocal = parseEnvLocal(app.envLocalPath)
    for (const [name, value] of appEnvLocal.values) {
      if (value && !existingValues.has(name)) {
        existingValues.set(name, value)
      }
    }
  }

  // Create a virtual app context for resolving shared variables
  // If there are no apps, nothing to resolve
  if (apps.length === 0) {
    return { resolvedShared, sharedAdded, sharedSkipped, warnings }
  }

  const representativeApp = apps[0]
  const context: ResolverContext = {
    app: representativeApp,
    currentValues: existingValues,
    interactive,
    config,
    rootDir,
  }

  // Check each shared variable
  for (const variable of rootSchema) {
    const existingValue = existingValues.get(variable.name)

    if (existingValue !== undefined && existingValue !== '') {
      // Already exists in at least one app - use it
      resolvedShared.set(variable.name, existingValue)
      if (verbose) {
        reporter.printValid(variable.name, 'exists')
      }
    } else {
      // Need to resolve (prompt user)
      const resolved = await resolveValue(variable, context)

      if (resolved.warning) {
        warnings.push(resolved.warning)
      }

      if (!resolved.skipped && resolved.value) {
        resolvedShared.set(variable.name, resolved.value)
        context.currentValues.set(variable.name, resolved.value) // For subsequent copy operations
        reporter.printAdded(variable.name, variable.directive.type)
        sharedAdded++
      } else if (variable.requirement === 'required') {
        reporter.printSkipped(variable.name)
        sharedSkipped++
      } else {
        reporter.printMissingOptional(variable.name)
        sharedSkipped++
      }
    }
  }

  return { resolvedShared, sharedAdded, sharedSkipped, warnings }
}

/**
 * Run the sync command
 */
export async function runSync(options: SyncOptions): Promise<number> {
  const { app, all, verbose, force, rootDir, config } = options

  reporter.printHeader()

  // Get all apps (we need all to compute canonical values even if filtering)
  const allApps = (await scanWorkspaces(config, rootDir)).filter(hasEnvExample)

  // Get apps to sync (may be filtered)
  let apps: AppInfo[] = []

  if (app) {
    // Specific app
    const foundApp = await findWorkspace(app, config, rootDir)
    if (!foundApp) {
      reporter.printError(`App not found: ${app}`)
      return 1
    }
    apps = [foundApp]
  } else if (all) {
    // All apps
    apps = allApps
  } else {
    // Current app or all
    const currentApp = await detectCurrentWorkspace(config, rootDir)
    if (currentApp && hasEnvExample(currentApp)) {
      apps = [currentApp]
    } else {
      // Default to all apps with schemas
      apps = allApps
    }
  }

  if (apps.length === 0) {
    reporter.printInfo('No apps with .env.local.example files found.')
    return 0
  }

  // Execute beforeSync hooks
  await executeBeforeSyncHooks(apps)

  // Get root schema and paths
  const { examplePath: rootExamplePath, localPath: rootLocalPath } = getRootEnvPaths(
    config,
    rootDir
  )
  const pluginSources = getValueSources()
  const rootSchema = parseEnvExample(rootExamplePath, { pluginSources })

  if (rootSchema.variables.length === 0) {
    reporter.printWarning('No root .env.local.example found. Create one with shared variables.')
  }

  // Compute shared variable names and canonical values for override detection
  const sharedVarNames = new Set(rootSchema.variables.map((v) => v.name))
  const sharedValues = computeCanonicalSharedValues(sharedVarNames, allApps)

  // Track overall stats
  let totalAdded = 0
  let totalSkipped = 0
  const allWarnings: string[] = []
  const results: ReconciliationResult[] = []

  // STEP 1: Resolve shared variables first (prompt once)
  if (rootSchema.variables.length > 0) {
    reporter.printCheckingShared()

    const {
      resolvedShared,
      sharedAdded,
      sharedSkipped,
      warnings: sharedWarnings,
    } = await resolveSharedVariables(rootSchema.variables, apps, {
      interactive: !force,
      verbose,
      rootDir,
      config,
    })

    totalAdded += sharedAdded
    totalSkipped += sharedSkipped
    allWarnings.push(...sharedWarnings)

    // Apply shared values to root .env.local (cache)
    const rootActual = parseEnvLocal(rootLocalPath)
    const rootUpdates = new Map<string, string>()
    for (const [name, value] of resolvedShared) {
      const existing = rootActual.values.get(name)
      if (existing === undefined || existing === '') {
        rootUpdates.set(name, value)
      }
    }
    if (rootUpdates.size > 0) {
      const newContent = updateEnvLocalContent(rootActual, rootUpdates, rootSchema.variables)
      fs.writeFileSync(rootLocalPath, newContent)
    }

    // Apply shared values to EACH app's .env.local
    // (Next.js only loads .env.local from the app directory, not monorepo root)
    for (const appInfo of apps) {
      const appEnvLocal = parseEnvLocal(appInfo.envLocalPath)
      const updates = new Map<string, string>()

      // Only add shared variables that don't already exist in this app
      for (const [name, value] of resolvedShared) {
        const existingValue = appEnvLocal.values.get(name)
        if (existingValue === undefined || existingValue === '') {
          updates.set(name, value)
        }
      }

      if (updates.size > 0) {
        applyUpdates(appInfo, updates, { rootDir, config, pluginSources })
      }
    }

    console.log('')
  }

  // STEP 2: Process app-specific variables for each app
  for (const appInfo of apps) {
    // Get app-specific schema (not including shared)
    const appSpecificSchema = parseEnvExample(appInfo.envExamplePath, { pluginSources })

    if (appSpecificSchema.variables.length === 0) {
      // No app-specific variables, just check status
      const schema = getAppSchema(appInfo, { rootDir, config, pluginSources })
      const actual = parseEnvLocal(appInfo.envLocalPath)
      const result = compareSchemaToActual(schema, actual, appInfo, sharedValues, sharedVarNames)
      results.push(result)

      reporter.printCheckingApp(appInfo.name)
      reporter.printAllOk(result.valid.length)

      // Print overrides if any
      if (result.overrides.size > 0) {
        for (const name of result.overrides.keys()) {
          reporter.printOverride(name)
        }
      }

      console.log('')
      continue
    }

    reporter.printCheckingApp(appInfo.name)

    // Create context with current values (including newly added shared vars)
    const actual = parseEnvLocal(appInfo.envLocalPath)
    const context: ResolverContext = {
      app: appInfo,
      currentValues: actual.values,
      interactive: !force,
      config,
      rootDir,
    }

    const updates = new Map<string, string>()
    let appAdded = 0
    let appSkipped = 0

    // Process only app-specific variables
    for (const variable of appSpecificSchema.variables) {
      const existingValue = actual.values.get(variable.name)

      if (existingValue !== undefined && existingValue !== '') {
        if (verbose) {
          reporter.printValid(variable.name, 'exists')
        }
      } else {
        const resolved = await resolveValue(variable, context)

        if (resolved.warning) {
          allWarnings.push(resolved.warning)
        }

        if (!resolved.skipped && resolved.value) {
          updates.set(variable.name, resolved.value)
          context.currentValues.set(variable.name, resolved.value)
          reporter.printAdded(variable.name, variable.directive.type)
          appAdded++
        } else if (variable.requirement === 'required') {
          reporter.printSkipped(variable.name)
          appSkipped++
        } else {
          reporter.printMissingOptional(variable.name)
          appSkipped++
        }
      }
    }

    totalAdded += appAdded
    totalSkipped += appSkipped

    // Get full result for status tracking
    const fullSchema = getAppSchema(appInfo, { rootDir, config, pluginSources })
    const updatedActual = parseEnvLocal(appInfo.envLocalPath)
    // Merge in updates we're about to apply
    for (const [name, value] of updates) {
      updatedActual.values.set(name, value)
    }
    const result = compareSchemaToActual(
      fullSchema,
      updatedActual,
      appInfo,
      sharedValues,
      sharedVarNames
    )
    results.push(result)

    if (appAdded === 0 && appSkipped === 0 && appSpecificSchema.variables.length > 0) {
      reporter.printAllOk(appSpecificSchema.variables.length)
    }

    // Print overrides if any
    if (result.overrides.size > 0) {
      for (const name of result.overrides.keys()) {
        reporter.printOverride(name)
      }
    }

    // Apply updates
    if (updates.size > 0) {
      applyUpdates(appInfo, updates, { rootDir, config, pluginSources })
    }

    console.log('')
  }

  // Execute afterSync hooks
  await executeAfterSyncHooks(results)

  // Print warnings
  for (const warning of allWarnings) {
    reporter.printWarning(warning)
  }

  // Print summary
  reporter.printSummary(apps.length, totalAdded, totalSkipped, allWarnings.length)

  // Print next steps
  reporter.printNextSteps(allWarnings.length > 0 || totalSkipped > 0)

  return 0
}
