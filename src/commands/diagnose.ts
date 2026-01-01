/**
 * Diagnose command - Scan source code for env issues
 */

import type { EnvDoctorConfig, AppInfo } from '../core/types.js'
import {
  scanWorkspaces,
  getRootEnvPaths,
  hasEnvExample,
  detectCurrentWorkspace,
  findWorkspace,
} from '../core/scanner.js'
import { parseEnvExample } from '../core/parser.js'
import {
  scanAppSources,
  scanPackageSources,
  mergeScanResults,
  diagnoseEnvUsage,
} from '../core/source-scanner.js'
import { getValueSources } from '../plugins/registry.js'
import * as reporter from '../core/reporter.js'

interface DiagnoseOptions {
  app?: string
  all?: boolean
  verbose?: boolean
  rootDir: string
  config: EnvDoctorConfig
}

/**
 * Run the diagnose command
 */
export async function runDiagnose(options: DiagnoseOptions): Promise<number> {
  const { app, all, verbose, rootDir, config } = options

  reporter.printDiagnoseHeader()

  // Get apps to scan
  let apps: AppInfo[] = []

  if (app) {
    const foundApp = await findWorkspace(app, config, rootDir)
    if (!foundApp) {
      reporter.printError(`App not found: ${app}`)
      return 1
    }
    apps = [foundApp]
  } else if (all) {
    apps = await scanWorkspaces(config, rootDir)
  } else {
    const currentApp = await detectCurrentWorkspace(config, rootDir)
    if (currentApp) {
      apps = [currentApp]
    } else {
      apps = await scanWorkspaces(config, rootDir)
    }
  }

  // Collect all schema variables
  const { examplePath: rootExamplePath } = getRootEnvPaths(config, rootDir)
  const pluginSources = getValueSources()
  const rootSchema = parseEnvExample(rootExamplePath, { pluginSources })
  const schemaVars = new Set<string>()

  for (const v of rootSchema.variables) {
    schemaVars.add(v.name)
  }

  // Add app-specific schemas
  for (const appInfo of apps) {
    if (hasEnvExample(appInfo)) {
      const appSchema = parseEnvExample(appInfo.envExamplePath, { pluginSources })
      for (const v of appSchema.variables) {
        schemaVars.add(v.name)
      }
    }
  }

  // Scan source code
  const scanResults = []

  // Scan each app
  for (const appInfo of apps) {
    reporter.printDiagnoseScanning(appInfo.name)
    const result = scanAppSources(appInfo, config)
    scanResults.push(result)
    reporter.printDiagnoseScanComplete(result.filesScanned, result.usedVars.size)
  }

  // Also scan packages
  reporter.printDiagnoseScanning('packages')
  const packagesResult = scanPackageSources(rootDir, config)
  scanResults.push(packagesResult)
  reporter.printDiagnoseScanComplete(packagesResult.filesScanned, packagesResult.usedVars.size)

  // Merge results
  const merged = mergeScanResults(scanResults)

  // Diagnose
  const diagnosis = diagnoseEnvUsage(merged.usedVars, schemaVars, config)

  // Report missing (used but not in schema)
  reporter.printDiagnoseSection('Missing from schema:')
  if (diagnosis.missing.size === 0) {
    reporter.printDiagnoseNoIssues('All used variables are documented')
  } else {
    for (const [name, usages] of diagnosis.missing) {
      const firstUsage = usages[0]
      reporter.printDiagnoseMissing(name, usages.length, firstUsage)

      if (verbose) {
        for (const usage of usages.slice(0, 3)) {
          reporter.printDiagnoseUsageLocation(usage.file, usage.line, usage.pattern)
        }
        if (usages.length > 3) {
          console.log(`    ... and ${usages.length - 3} more`)
        }
      }
    }
  }

  console.log('')

  // Report unused (in schema but not used)
  reporter.printDiagnoseSection('Potentially unused:')
  if (diagnosis.unused.size === 0) {
    reporter.printDiagnoseNoIssues('All schema variables are used')
  } else {
    for (const name of diagnosis.unused) {
      reporter.printDiagnoseUnused(name)
    }
  }

  // Summary
  reporter.printDiagnoseSummary(diagnosis.missing.size, diagnosis.unused.size, diagnosis.defined.size)

  // Next steps
  const envExampleName = config.project?.rootEnvExample || '.env.local.example'
  reporter.printDiagnoseNextSteps(diagnosis.missing.size > 0, envExampleName)

  return diagnosis.missing.size > 0 ? 1 : 0
}
