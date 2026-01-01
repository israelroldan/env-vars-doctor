/**
 * Reconciler - compare schema with actual .env.local and resolve differences
 */

import * as fs from 'node:fs'
import type {
  AppInfo,
  EnvVarDefinition,
  EnvLocalValues,
  ReconciliationResult,
  ResolverContext,
  EnvDoctorConfig,
  ValueSourceProvider,
} from './types.js'
import { parseEnvExample, parseEnvLocal, mergeSchemas, updateEnvLocalContent } from './parser.js'
import { getRootEnvPaths } from './scanner.js'

// =============================================================================
// Schema Operations
// =============================================================================

/**
 * Options for getting app schema
 */
export interface GetAppSchemaOptions {
  /** Root directory */
  rootDir: string
  /** Configuration */
  config: EnvDoctorConfig
  /** Plugin-provided value sources */
  pluginSources?: ValueSourceProvider[]
}

/**
 * Get merged schema for an app (root + app-specific)
 */
export function getAppSchema(app: AppInfo, options: GetAppSchemaOptions): EnvVarDefinition[] {
  const { rootDir, config, pluginSources } = options
  const { examplePath: rootExamplePath } = getRootEnvPaths(config, rootDir)

  // Parse root schema
  const rootSchema = parseEnvExample(rootExamplePath, { pluginSources })

  // Parse app-specific schema
  const appSchema = parseEnvExample(app.envExamplePath, { pluginSources })

  // Merge (app overrides root)
  return mergeSchemas(rootSchema, appSchema)
}

// =============================================================================
// Comparison
// =============================================================================

/**
 * Compare schema against actual values
 * @param sharedValues - Optional map of shared variable values (for detecting overrides)
 * @param sharedVarNames - Optional set of variable names that are shared (from root schema)
 */
export function compareSchemaToActual(
  schema: EnvVarDefinition[],
  actual: EnvLocalValues,
  app: AppInfo,
  sharedValues?: Map<string, string>,
  sharedVarNames?: Set<string>
): ReconciliationResult {
  const valid: EnvVarDefinition[] = []
  const missing: EnvVarDefinition[] = []
  const deprecated: string[] = []
  const overrides = new Map<string, string>()
  const schemaNames = new Set(schema.map((v) => v.name))

  // Check each schema variable
  for (const variable of schema) {
    const actualValue = actual.values.get(variable.name)

    if (variable.requirement === 'deprecated') {
      // Deprecated variables that still exist
      if (actualValue !== undefined) {
        deprecated.push(variable.name)
      }
    } else if (actualValue !== undefined && actualValue !== '') {
      // Variable exists with value
      valid.push(variable)

      // Check if this is a shared variable with a different value (override)
      if (sharedValues && sharedVarNames?.has(variable.name)) {
        const sharedValue = sharedValues.get(variable.name)
        if (sharedValue !== undefined && sharedValue !== actualValue) {
          overrides.set(variable.name, actualValue)
        }
      }
    } else {
      // Variable missing or empty
      missing.push(variable)
    }
  }

  // Find extra variables not in schema
  const extra: string[] = []
  for (const name of actual.values.keys()) {
    if (!schemaNames.has(name)) {
      extra.push(name)
    }
  }

  return {
    app,
    valid,
    missing,
    extra,
    deprecated,
    overrides,
  }
}

// =============================================================================
// Reconciliation
// =============================================================================

/**
 * Value resolver function type
 */
export type ValueResolver = (
  definition: EnvVarDefinition,
  context: ResolverContext
) => Promise<{ value: string; skipped?: boolean; warning?: string }>

/**
 * Options for reconciling an app
 */
export interface ReconcileAppOptions {
  /** Whether to prompt interactively */
  interactive: boolean
  /** Verbose output */
  verbose?: boolean
  /** Root directory */
  rootDir: string
  /** Configuration (fully resolved with defaults) */
  config: Required<EnvDoctorConfig>
  /** Value resolver function */
  resolveValue: ValueResolver
  /** Plugin-provided value sources */
  pluginSources?: ValueSourceProvider[]
  /** Canonical shared values (for detecting overrides) */
  sharedValues?: Map<string, string>
  /** Names of shared variables (from root schema) */
  sharedVarNames?: Set<string>
}

/**
 * Reconcile a single app
 */
export async function reconcileApp(
  app: AppInfo,
  options: ReconcileAppOptions
): Promise<{
  result: ReconciliationResult
  updates: Map<string, string>
  warnings: string[]
}> {
  const {
    interactive,
    rootDir,
    config,
    resolveValue,
    pluginSources,
    sharedValues,
    sharedVarNames,
  } = options
  const warnings: string[] = []

  // Get merged schema
  const schema = getAppSchema(app, { rootDir, config, pluginSources })

  // Parse current .env.local
  const actual = parseEnvLocal(app.envLocalPath)

  // Compare
  const result = compareSchemaToActual(schema, actual, app, sharedValues, sharedVarNames)

  // Create resolver context
  const context: ResolverContext = {
    app,
    currentValues: actual.values,
    interactive,
    config,
    rootDir,
  }

  // Resolve missing values
  const updates = new Map<string, string>()

  for (const missing of result.missing) {
    const resolved = await resolveValue(missing, context)

    if (resolved.warning) {
      warnings.push(resolved.warning)
    }

    if (!resolved.skipped) {
      updates.set(missing.name, resolved.value)

      // Also update context for subsequent copy operations
      context.currentValues.set(missing.name, resolved.value)
    }
  }

  return { result, updates, warnings }
}

/**
 * Apply updates to an app's .env.local file
 */
export function applyUpdates(
  app: AppInfo,
  updates: Map<string, string>,
  options: GetAppSchemaOptions
): void {
  if (updates.size === 0) {
    return
  }

  // Get schema for comment generation
  const schema = getAppSchema(app, options)

  // Read current content
  const actual = parseEnvLocal(app.envLocalPath)

  // Generate updated content
  const newContent = updateEnvLocalContent(actual, updates, schema)

  // Write file
  fs.writeFileSync(app.envLocalPath, newContent)
}

/**
 * Options for reconciling all apps
 */
export interface ReconcileAllAppsOptions {
  /** Whether to prompt interactively */
  interactive: boolean
  /** Verbose output */
  verbose?: boolean
  /** Dry run (don't write files) */
  dryRun?: boolean
  /** Root directory */
  rootDir: string
  /** Configuration (fully resolved with defaults) */
  config: Required<EnvDoctorConfig>
  /** Value resolver function */
  resolveValue: ValueResolver
  /** Plugin-provided value sources */
  pluginSources?: ValueSourceProvider[]
}

/**
 * Reconcile all apps
 */
export async function reconcileAllApps(
  apps: AppInfo[],
  options: ReconcileAllAppsOptions
): Promise<{
  results: ReconciliationResult[]
  totalUpdates: number
  warnings: string[]
}> {
  const { dryRun, rootDir, config, pluginSources } = options
  const results: ReconciliationResult[] = []
  const allWarnings: string[] = []
  let totalUpdates = 0

  for (const app of apps) {
    const { result, updates, warnings } = await reconcileApp(app, options)

    results.push(result)
    allWarnings.push(...warnings)

    if (!dryRun && updates.size > 0) {
      applyUpdates(app, updates, { rootDir, config, pluginSources })
      totalUpdates += updates.size
    }
  }

  return {
    results,
    totalUpdates,
    warnings: allWarnings,
  }
}
