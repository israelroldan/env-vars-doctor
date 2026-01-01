/**
 * Check command - Validate environment without prompts
 */

import type { EnvDoctorConfig, AppInfo } from '../core/types.js'
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

interface CheckOptions {
  app?: string
  all?: boolean
  verbose?: boolean
  rootDir: string
  config: EnvDoctorConfig
}

/**
 * Run the check command
 */
export async function runCheck(options: CheckOptions): Promise<number> {
  const { app, all, verbose, rootDir, config } = options

  reporter.printHeader()

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
    reporter.printInfo('No apps with .env.local.example files found.')
    return 0
  }

  const pluginSources = getValueSources()
  let hasErrors = false

  for (const appInfo of apps) {
    reporter.printCheckingApp(appInfo.name)

    const schema = getAppSchema(appInfo, { rootDir, config, pluginSources })
    const actual = parseEnvLocal(appInfo.envLocalPath)
    const result = compareSchemaToActual(schema, actual, appInfo)

    const missingRequired = result.missing.filter((v) => v.requirement === 'required')
    const missingOptional = result.missing.filter((v) => v.requirement === 'optional')

    if (missingRequired.length > 0) {
      hasErrors = true
      for (const v of missingRequired) {
        reporter.printMissingRequired(v.name)
      }
    }

    if (missingOptional.length > 0 && verbose) {
      for (const v of missingOptional) {
        reporter.printMissingOptional(v.name)
      }
    }

    if (result.deprecated.length > 0) {
      for (const name of result.deprecated) {
        reporter.printDeprecated(name)
      }
    }

    if (missingRequired.length === 0) {
      reporter.printAllOk(result.valid.length)
    }
  }

  if (hasErrors) {
    console.log('')
    reporter.printError('Some required environment variables are missing.')
    reporter.printNextSteps(true)
    return 1
  }

  reporter.printNothingToDo()
  return 0
}
