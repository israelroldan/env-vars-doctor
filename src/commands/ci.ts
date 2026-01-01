/**
 * CI command - Validate environment for CI/CD
 */

import type { EnvDoctorConfig, AppInfo } from '../core/types.js'
import {
  scanWorkspaces,
  getRootEnvPaths,
  hasEnvExample,
  detectCurrentWorkspace,
  findWorkspace,
} from '../core/scanner.js'
import { parseEnvExample, mergeSchemas } from '../core/parser.js'
import { getValueSources } from '../plugins/registry.js'
import { shouldSkip, isCI } from '../core/config.js'
import * as reporter from '../core/reporter.js'

interface CiOptions {
  app?: string
  all?: boolean
  verbose?: boolean
  rootDir: string
  config: EnvDoctorConfig
}

/**
 * Run the CI command
 */
export async function runCi(options: CiOptions): Promise<number> {
  const { app, all, verbose, rootDir, config } = options

  // Check if we should skip
  if (shouldSkip(config)) {
    reporter.printInfo('Skipping env-doctor check (skip env var is set)')
    return 0
  }

  reporter.printCiHeader()

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
  const skipDirectives = config.ci?.skipDirectives || ['local-only', 'prompt']
  let hasErrors = false

  for (const appInfo of apps) {
    reporter.printCiCheckingSection(appInfo.name)

    // Get merged schema
    const { examplePath: rootExamplePath } = getRootEnvPaths(config, rootDir)
    const rootSchema = parseEnvExample(rootExamplePath, { pluginSources })
    const appSchema = parseEnvExample(appInfo.envExamplePath, { pluginSources })
    const schema = mergeSchemas(rootSchema, appSchema)

    let checkedCount = 0
    let missingRequired = 0
    let missingOptional = 0

    for (const variable of schema) {
      // Skip certain directives in CI
      if (skipDirectives.includes(variable.directive.type)) {
        reporter.printCiSkipped(variable.name, `${variable.directive.type} skipped in CI`)
        continue
      }

      checkedCount++

      // Check if variable is set in environment
      const value = process.env[variable.name]

      if (value !== undefined && value !== '') {
        reporter.printCiPresent(variable.name)
      } else if (variable.requirement === 'required') {
        reporter.printCiMissingRequired(variable.name)
        missingRequired++
        hasErrors = true
      } else {
        reporter.printCiMissingOptional(variable.name)
        missingOptional++
      }
    }

    reporter.printCiSummary(appInfo.name, checkedCount, missingRequired, missingOptional)
  }

  return hasErrors ? 1 : 0
}
