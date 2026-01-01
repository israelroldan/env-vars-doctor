/**
 * Postinstall command - Check environment status after npm/pnpm install
 *
 * In CI: runs CI mode (validates process.env, exits 1 if required missing)
 * Locally: just reports status (never fails)
 */

import { isCI } from '../core/config.js'
import type { EnvDoctorConfig } from '../core/types.js'
import { runCi } from './ci.js'
import { scanWorkspaces, getRootEnvPaths, hasEnvExample } from '../core/scanner.js'
import { parseEnvExample, parseEnvLocal } from '../core/parser.js'

// Simple boxen-like output
function printBox(message: string): void {
  const lines = message.split('\n')
  const maxLen = Math.max(...lines.map((l) => l.length))
  const border = '─'.repeat(maxLen + 2)

  console.log(`╭${border}╮`)
  for (const line of lines) {
    const padding = ' '.repeat(maxLen - line.length)
    console.log(`│ ${line}${padding} │`)
  }
  console.log(`╰${border}╯`)
}

interface PostinstallOptions {
  app?: string
  verbose?: boolean
  rootDir: string
  config: Required<EnvDoctorConfig>
}

/**
 * Run the postinstall command
 */
export async function runPostinstall(options: PostinstallOptions): Promise<number> {
  const { rootDir, config } = options

  // In CI, delegate to CI check
  if (isCI(config)) {
    return runCi(options)
  }

  // Local: check .env.local files and report
  const apps = await scanWorkspaces(config, rootDir)
  const appsWithSchemas = apps.filter(hasEnvExample)

  // Track unique missing variables
  const missingRequiredSet = new Set<string>()
  const missingOptionalSet = new Set<string>()

  // Check root/shared schema
  const { examplePath: rootExamplePath } = getRootEnvPaths(config, rootDir)
  const rootSchema = parseEnvExample(rootExamplePath)

  // For shared variables, check if they're missing from ANY app
  for (const variable of rootSchema.variables) {
    let missingFromSomeApp = false

    for (const app of appsWithSchemas) {
      const appEnvLocal = parseEnvLocal(app.envLocalPath)
      const existingValue = appEnvLocal.values.get(variable.name)
      if (existingValue === undefined || existingValue === '') {
        missingFromSomeApp = true
        break
      }
    }

    if (missingFromSomeApp) {
      if (variable.requirement === 'required') {
        missingRequiredSet.add(variable.name)
      } else if (variable.requirement === 'optional') {
        missingOptionalSet.add(variable.name)
      }
    }
  }

  // Check app-specific variables
  for (const app of appsWithSchemas) {
    const appSchema = parseEnvExample(app.envExamplePath)
    const appEnvLocal = parseEnvLocal(app.envLocalPath)

    for (const variable of appSchema.variables) {
      const existingValue = appEnvLocal.values.get(variable.name)
      if (existingValue === undefined || existingValue === '') {
        if (variable.requirement === 'required') {
          missingRequiredSet.add(variable.name)
        } else if (variable.requirement === 'optional') {
          missingOptionalSet.add(variable.name)
        }
      }
    }
  }

  // Print result
  if (missingRequiredSet.size > 0 || missingOptionalSet.size > 0) {
    const reqCount = missingRequiredSet.size
    const optCount = missingOptionalSet.size

    let message = 'env-vars-doctor\n\n'
    if (reqCount > 0) {
      message += `${reqCount} required variable${reqCount > 1 ? 's' : ''} missing\n`
    }
    if (optCount > 0) {
      message += `${optCount} optional variable${optCount > 1 ? 's' : ''} missing\n`
    }
    message += '\nRun: pnpm env-vars-doctor'

    printBox(message)
  } else {
    printBox('env-vars-doctor\n\nEnvironment ready')
  }

  // Never fail locally
  return 0
}
