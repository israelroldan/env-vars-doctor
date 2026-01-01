#!/usr/bin/env node
/**
 * env-doctor CLI
 */

import { loadConfig } from './core/config.js'
import { loadPlugins } from './plugins/loader.js'
import { executeOnInitHooks } from './plugins/registry.js'
import { detectMonorepoRoot } from './core/scanner.js'
import * as reporter from './core/reporter.js'

// Import commands
import { runSync } from './commands/sync.js'
import { runStatus } from './commands/status.js'
import { runCheck } from './commands/check.js'
import { runDiagnose } from './commands/diagnose.js'
import { runClean } from './commands/clean.js'
import { runCi } from './commands/ci.js'
import { runExport } from './commands/export.js'
import { runDeploy } from './commands/deploy.js'
import { runPostinstall } from './commands/postinstall.js'

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface ParsedArgs {
  command: string
  app?: string
  verbose?: boolean
  force?: boolean
  all?: boolean
  format?: string
  target?: string
  help?: boolean
  version?: boolean
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: 'sync',
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '--help' || arg === '-h') {
      result.help = true
    } else if (arg === '--version' || arg === '-v') {
      result.version = true
    } else if (arg === '--verbose') {
      result.verbose = true
    } else if (arg === '--force' || arg === '-f') {
      result.force = true
    } else if (arg === '--all' || arg === '-a') {
      result.all = true
    } else if (arg.startsWith('--app=')) {
      result.app = arg.split('=')[1]
    } else if (arg === '--app' && args[i + 1]) {
      result.app = args[++i]
    } else if (arg.startsWith('--format=')) {
      result.format = arg.split('=')[1]
    } else if (arg === '--format' && args[i + 1]) {
      result.format = args[++i]
    } else if (arg.startsWith('--target=')) {
      result.target = arg.split('=')[1]
    } else if (arg === '--target' && args[i + 1]) {
      result.target = args[++i]
    } else if (!arg.startsWith('-')) {
      // First non-flag argument is the command
      if (!result.command || result.command === 'sync') {
        result.command = arg
      }
    }

    i++
  }

  return result
}

// =============================================================================
// Help
// =============================================================================

function printHelp(): void {
  console.log(`
env-doctor - Environment variable management for monorepos

Usage:
  env-doctor [command] [options]

Commands:
  sync        Create or update .env.local files (default)
  status      Show environment variable status
  check       Validate environment without prompts
  diagnose    Scan source code for env issues
  clean       Remove generated .env.local files
  ci          CI mode validation
  export      Export variables for deployment
  deploy      Push variables to deployment platforms

Options:
  --app <name>     Target specific app
  --all, -a        Process all apps
  --force, -f      Overwrite existing values
  --verbose        Verbose output
  --format <fmt>   Export format (vercel, shell, json)
  --target <env>   Deployment target
  --help, -h       Show help
  --version, -v    Show version

Examples:
  env-doctor                    # Sync current app or all apps
  env-doctor sync --all         # Sync all apps
  env-doctor status             # Show status
  env-doctor diagnose           # Check for missing/unused vars
  env-doctor export --format=vercel
`)
}

function printVersion(): void {
  console.log('env-doctor v0.1.0')
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  if (args.version) {
    printVersion()
    process.exit(0)
  }

  try {
    // Load configuration
    const rootDir = detectMonorepoRoot()
    const { config, found } = await loadConfig(rootDir)

    if (args.verbose && found) {
      reporter.printInfo('Loaded configuration')
    }

    // Load plugins
    await loadPlugins(config)
    await executeOnInitHooks(config)

    // Run command
    const commandOptions = {
      app: args.app,
      all: args.all,
      verbose: args.verbose,
      force: args.force,
      format: args.format,
      target: args.target,
      rootDir,
      config,
    }

    let exitCode = 0

    switch (args.command) {
      case 'sync':
        exitCode = await runSync(commandOptions)
        break

      case 'status':
        exitCode = await runStatus(commandOptions)
        break

      case 'check':
        exitCode = await runCheck(commandOptions)
        break

      case 'diagnose':
        exitCode = await runDiagnose(commandOptions)
        break

      case 'clean':
        exitCode = await runClean(commandOptions)
        break

      case 'ci':
        exitCode = await runCi(commandOptions)
        break

      case 'export':
        exitCode = await runExport(commandOptions)
        break

      case 'deploy':
        exitCode = await runDeploy(commandOptions)
        break

      case 'postinstall':
        exitCode = await runPostinstall(commandOptions)
        break

      default:
        reporter.printError(`Unknown command: ${args.command}`)
        printHelp()
        exitCode = 1
    }

    process.exit(exitCode)
  } catch (error) {
    reporter.printError(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main()
