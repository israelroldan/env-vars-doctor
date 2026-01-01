/**
 * Export command - Export variables for deployment
 *
 * Formats:
 * - json: Export per-app with { required, optional, appSpecific, shared } structure
 * - shell: Export as shell environment variables (export KEY='value')
 * - vercel: Export in Vercel format (KEY="value")
 * - values: Export just key=value pairs (the actual values from .env.local)
 */

import type { EnvDoctorConfig, AppInfo } from '../core/types.js'
import {
  scanWorkspaces,
  getRootEnvPaths,
  hasEnvExample,
  detectCurrentWorkspace,
  findWorkspace,
} from '../core/scanner.js'
import { parseEnvLocal, parseEnvExample } from '../core/parser.js'
import { getAppSchema } from '../core/reconciler.js'
import { getValueSources } from '../plugins/registry.js'
import * as reporter from '../core/reporter.js'

interface ExportOptions {
  app?: string
  all?: boolean
  format?: string
  target?: string
  verbose?: boolean
  rootDir: string
  config: EnvDoctorConfig
}

type ExportFormat = 'vercel' | 'shell' | 'json' | 'values'

/**
 * Run the export command
 */
export async function runExport(options: ExportOptions): Promise<number> {
  const { app, all, format = 'json', rootDir, config } = options
  const exportFormat = format as ExportFormat
  const pluginSources = getValueSources()

  // Get root schema to know which variables are shared
  const { examplePath: rootExamplePath } = getRootEnvPaths(config, rootDir)
  const rootSchema = parseEnvExample(rootExamplePath, { pluginSources })
  const sharedVarNames = new Set(rootSchema.variables.map((v) => v.name))

  // For JSON format, we can export all apps at once (matching original behavior)
  if (exportFormat === 'json') {
    // Get apps to export
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
      // Default to all apps with schemas (matching original behavior)
      apps = await scanWorkspaces(config, rootDir)
      apps = apps.filter(hasEnvExample)
    }

    if (apps.length === 0) {
      reporter.printError('No apps with .env.local.example files found.')
      return 1
    }

    // Build JSON output matching original format:
    // { "app-name": { required: [...], optional: [...], appSpecific: [...], shared: [...] } }
    const output: Record<
      string,
      {
        required: string[]
        optional: string[]
        appSpecific: string[]
        shared: string[]
      }
    > = {}

    for (const appInfo of apps) {
      const schema = getAppSchema(appInfo, { rootDir, config, pluginSources })

      // Separate required and optional
      const required = schema.filter((v) => v.requirement === 'required').map((v) => v.name)

      const optional = schema.filter((v) => v.requirement === 'optional').map((v) => v.name)

      // Separate app-specific from shared
      const appSpecific = schema.filter((v) => !sharedVarNames.has(v.name)).map((v) => v.name)

      const shared = schema.filter((v) => sharedVarNames.has(v.name)).map((v) => v.name)

      output[appInfo.name] = {
        required,
        optional,
        appSpecific,
        shared,
      }
    }

    // Output JSON
    console.log(JSON.stringify(output, null, 2))
    return 0
  }

  // For other formats, we need a single app
  let appInfo: AppInfo | null = null

  if (app) {
    appInfo = await findWorkspace(app, config, rootDir)
    if (!appInfo) {
      reporter.printError(`App not found: ${app}`)
      return 1
    }
  } else {
    appInfo = await detectCurrentWorkspace(config, rootDir)
    if (!appInfo) {
      reporter.printError('Could not detect current app. Use --app to specify.')
      return 1
    }
  }

  if (!hasEnvExample(appInfo)) {
    reporter.printError(`App ${appInfo.name} has no .env.local.example file.`)
    return 1
  }

  // Get schema and values
  const schema = getAppSchema(appInfo, { rootDir, config, pluginSources })
  const envLocal = parseEnvLocal(appInfo.envLocalPath)

  // Build export data
  const exportData: Record<string, string> = {}

  for (const variable of schema) {
    const value = envLocal.values.get(variable.name)
    if (value !== undefined && value !== '') {
      exportData[variable.name] = value
    }
  }

  // Output based on format
  switch (exportFormat) {
    case 'values':
      // Simple key=value pairs
      for (const [key, value] of Object.entries(exportData)) {
        console.log(`${key}=${value}`)
      }
      break

    case 'shell':
      for (const [key, value] of Object.entries(exportData)) {
        // Escape single quotes in value
        const escapedValue = value.replace(/'/g, "'\\''")
        console.log(`export ${key}='${escapedValue}'`)
      }
      break

    case 'vercel':
      // Vercel CLI format
      for (const [key, value] of Object.entries(exportData)) {
        console.log(`${key}="${value}"`)
      }
      break

    default:
      reporter.printError(`Unknown format: ${format}. Use: json, vercel, shell, or values`)
      return 1
  }

  return 0
}
