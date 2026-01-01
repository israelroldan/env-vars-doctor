/**
 * Clean command - Remove generated .env.local files
 */

import * as fs from 'node:fs'
import type { EnvDoctorConfig, AppInfo } from '../core/types.js'
import {
  scanWorkspaces,
  getRootEnvPaths,
  hasEnvLocal,
  detectCurrentWorkspace,
  findWorkspace,
} from '../core/scanner.js'
import { confirm } from '../sources/prompt.js'
import * as reporter from '../core/reporter.js'

interface CleanOptions {
  app?: string
  all?: boolean
  force?: boolean
  verbose?: boolean
  rootDir: string
  config: EnvDoctorConfig
}

/**
 * Run the clean command
 */
export async function runClean(options: CleanOptions): Promise<number> {
  const { app, all, force, rootDir, config } = options

  reporter.printHeader()

  // Get apps to clean
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
    apps = apps.filter(hasEnvLocal)
  } else {
    const currentApp = await detectCurrentWorkspace(config, rootDir)
    if (currentApp && hasEnvLocal(currentApp)) {
      apps = [currentApp]
    } else {
      apps = await scanWorkspaces(config, rootDir)
      apps = apps.filter(hasEnvLocal)
    }
  }

  // Also check root
  const { localPath: rootLocalPath } = getRootEnvPaths(config, rootDir)
  const hasRootEnvLocal = fs.existsSync(rootLocalPath)

  if (apps.length === 0 && !hasRootEnvLocal) {
    reporter.printInfo('No .env.local files found to clean.')
    return 0
  }

  // Confirm if not forced
  if (!force) {
    const count = apps.length + (hasRootEnvLocal ? 1 : 0)
    const confirmed = await confirm(`Delete ${count} .env.local file(s)?`, false)

    if (!confirmed) {
      reporter.printInfo('Cancelled.')
      return 0
    }
  }

  let deleted = 0

  // Delete root env.local
  if (hasRootEnvLocal) {
    fs.unlinkSync(rootLocalPath)
    reporter.printInfo(`Deleted: ${rootLocalPath}`)
    deleted++
  }

  // Delete app env.local files
  for (const appInfo of apps) {
    if (hasEnvLocal(appInfo)) {
      fs.unlinkSync(appInfo.envLocalPath)
      reporter.printInfo(`Deleted: ${appInfo.envLocalPath}`)
      deleted++
    }
  }

  console.log('')
  reporter.printInfo(`Deleted ${deleted} file(s).`)

  return 0
}
