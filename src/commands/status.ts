/**
 * Status command - Show environment variable status
 */

import type { EnvDoctorConfig, AppInfo, ReconciliationResult } from '../core/types.js'
import {
  scanWorkspaces,
  getRootEnvPaths,
  hasEnvExample,
  detectCurrentWorkspace,
  findWorkspace,
} from '../core/scanner.js'
import { parseEnvLocal } from '../core/parser.js'
import { getAppSchema, compareSchemaToActual } from '../core/reconciler.js'
import { getValueSources } from '../plugins/registry.js'
import * as reporter from '../core/reporter.js'

interface StatusOptions {
  app?: string
  all?: boolean
  verbose?: boolean
  quiet?: boolean
  rootDir: string
  config: EnvDoctorConfig
}

/**
 * Run the status command
 */
export async function runStatus(options: StatusOptions): Promise<number> {
  const { app, all, quiet, rootDir, config } = options

  // Get apps to check
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
    apps = apps.filter(hasEnvExample)
  } else {
    const currentApp = await detectCurrentWorkspace(config, rootDir)
    if (currentApp && hasEnvExample(currentApp)) {
      apps = [currentApp]
    } else {
      apps = await scanWorkspaces(config, rootDir)
      apps = apps.filter(hasEnvExample)
    }
  }

  if (apps.length === 0) {
    if (!quiet) {
      reporter.printInfo('No apps with .env.local.example files found.')
    }
    return 0
  }

  const pluginSources = getValueSources()

  // Get shared values
  const { localPath: rootLocalPath } = getRootEnvPaths(config, rootDir)
  const rootEnvLocal = parseEnvLocal(rootLocalPath)
  const sharedValues = rootEnvLocal.values

  // Get shared var names
  const { examplePath: rootExamplePath } = getRootEnvPaths(config, rootDir)
  const sharedSchema = getAppSchema(
    { name: 'root', path: rootDir, envExamplePath: rootExamplePath, envLocalPath: rootLocalPath },
    { rootDir, config, pluginSources }
  )
  const sharedVarNames = new Set(sharedSchema.map((v) => v.name))

  // Check each app
  const results: ReconciliationResult[] = []
  let totalMissingRequired = 0
  let totalMissingOptional = 0

  for (const appInfo of apps) {
    const schema = getAppSchema(appInfo, { rootDir, config, pluginSources })
    const actual = parseEnvLocal(appInfo.envLocalPath)
    const result = compareSchemaToActual(schema, actual, appInfo, sharedValues, sharedVarNames)

    results.push(result)

    const missingRequired = result.missing.filter((v) => v.requirement === 'required')
    const missingOptional = result.missing.filter((v) => v.requirement === 'optional')

    totalMissingRequired += missingRequired.length
    totalMissingOptional += missingOptional.length
  }

  // Output
  if (quiet) {
    // Postinstall mode - minimal output
    if (totalMissingRequired > 0 || totalMissingOptional > 0) {
      reporter.printPostinstallActionNeeded(totalMissingRequired, totalMissingOptional)
    } else {
      reporter.printPostinstallOk()
    }
  } else {
    // Full status report
    reporter.printStatusReport(results)
  }

  // Return non-zero if there are missing required variables
  return totalMissingRequired > 0 ? 1 : 0
}
