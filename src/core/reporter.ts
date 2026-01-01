/**
 * Terminal output formatting for env-doctor
 */

import type { ReconciliationResult, ReporterOptions } from './types.js'

// =============================================================================
// ANSI Colors
// =============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
}

// Symbols
const symbols = {
  check: `${colors.green}✓${colors.reset}`,
  warning: `${colors.yellow}⚠${colors.reset}`,
  error: `${colors.red}✗${colors.reset}`,
  info: `${colors.cyan}ℹ${colors.reset}`,
  doctor: '🏥',
}

// =============================================================================
// Color Control
// =============================================================================

let colorsEnabled = true

/**
 * Set whether colors are enabled
 */
export function setColorsEnabled(enabled: boolean): void {
  colorsEnabled = enabled
}

/**
 * Get a color code (or empty string if colors disabled)
 */
function c(color: keyof typeof colors): string {
  return colorsEnabled ? colors[color] : ''
}

/**
 * Get a symbol (with or without colors)
 */
function s(symbol: keyof typeof symbols): string {
  if (!colorsEnabled) {
    switch (symbol) {
      case 'check':
        return '✓'
      case 'warning':
        return '⚠'
      case 'error':
        return '✗'
      case 'info':
        return 'ℹ'
      default:
        return symbols[symbol]
    }
  }
  return symbols[symbol]
}

// =============================================================================
// Basic Output
// =============================================================================

/**
 * Print the header
 */
export function printHeader(): void {
  console.log('')
  console.log(`${s('doctor')} ${c('bright')}env-doctor${c('reset')}`)
  console.log('')
}

/**
 * Print checking shared variables
 */
export function printCheckingShared(): void {
  console.log(`Checking ${c('cyan')}shared${c('reset')} variables...`)
}

/**
 * Print checking an app
 */
export function printCheckingApp(appName: string): void {
  console.log(`Checking ${c('cyan')}${appName}${c('reset')}...`)
}

// =============================================================================
// Variable Status
// =============================================================================

/**
 * Print a valid variable
 */
export function printValid(name: string, source?: string): void {
  const sourceHint = source ? ` ${c('dim')}(${source})${c('reset')}` : ''
  console.log(`  ${s('check')} ${name}${sourceHint}`)
}

/**
 * Print a computed variable
 */
export function printComputed(name: string, value: string): void {
  const shortValue = value.length > 40 ? value.substring(0, 40) + '...' : value
  console.log(`  ${s('check')} ${name} ${c('dim')}(computed: ${shortValue})${c('reset')}`)
}

/**
 * Print a missing required variable
 */
export function printMissingRequired(name: string): void {
  console.log(`  ${s('warning')} ${name} ${c('yellow')}(missing, required)${c('reset')}`)
}

/**
 * Print a missing optional variable
 */
export function printMissingOptional(name: string): void {
  console.log(`  ${s('info')} ${name} ${c('dim')}(missing, optional)${c('reset')}`)
}

/**
 * Print a deprecated variable
 */
export function printDeprecated(name: string): void {
  console.log(`  ${s('warning')} ${name} ${c('yellow')}(deprecated, can be removed)${c('reset')}`)
}

/**
 * Print an extra variable (not in schema)
 */
export function printExtra(name: string): void {
  console.log(`  ${s('info')} ${name} ${c('dim')}(not in schema)${c('reset')}`)
}

/**
 * Print an overridden shared variable
 */
export function printOverride(name: string): void {
  console.log(`  ${s('info')} ${name} ${c('magenta')}(overrides shared)${c('reset')}`)
}

/**
 * Print added variable
 */
export function printAdded(name: string, source: string): void {
  console.log(`  ${s('check')} ${name} ${c('green')}(added via ${source})${c('reset')}`)
}

/**
 * Print skipped variable
 */
export function printSkipped(name: string): void {
  console.log(`  ${s('warning')} ${name} ${c('yellow')}(skipped)${c('reset')}`)
}

/**
 * Print all variables OK message
 */
export function printAllOk(count: number): void {
  console.log(`  ${s('check')} All ${count} variables present`)
}

// =============================================================================
// Messages
// =============================================================================

/**
 * Print a warning
 */
export function printWarning(message: string): void {
  console.log(`${s('warning')} ${message}`)
}

/**
 * Print an error
 */
export function printError(message: string): void {
  console.error(`${s('error')} ${c('red')}${message}${c('reset')}`)
}

/**
 * Print info message
 */
export function printInfo(message: string): void {
  console.log(`${s('info')} ${message}`)
}

// =============================================================================
// Summary
// =============================================================================

/**
 * Print the summary
 */
export function printSummary(
  appsChecked: number,
  variablesAdded: number,
  variablesSkipped: number,
  warnings: number
): void {
  console.log('')
  console.log(`${c('bright')}Summary:${c('reset')}`)
  console.log(`  ${s('check')} ${appsChecked} app${appsChecked !== 1 ? 's' : ''} checked`)

  if (variablesAdded > 0) {
    console.log(
      `  ${s('check')} ${c('green')}${variablesAdded}${c('reset')} variable${variablesAdded !== 1 ? 's' : ''} added`
    )
  }

  if (variablesSkipped > 0) {
    console.log(
      `  ${s('warning')} ${variablesSkipped} optional variable${variablesSkipped !== 1 ? 's' : ''} skipped`
    )
  }

  if (warnings > 0) {
    console.log(`  ${s('warning')} ${warnings} warning${warnings !== 1 ? 's' : ''}`)
  }

  console.log('')
}

// =============================================================================
// Status Report
// =============================================================================

/**
 * Print status report for check command
 */
export function printStatusReport(results: ReconciliationResult[]): void {
  console.log('')
  console.log(`${c('bright')}Environment Status Report${c('reset')}`)
  console.log('')

  for (const result of results) {
    const { app, valid, missing, extra, deprecated, overrides } = result
    const missingRequired = missing.filter((v) => v.requirement === 'required')
    const missingOptional = missing.filter((v) => v.requirement === 'optional')

    console.log(`${c('cyan')}${app.name}${c('reset')}`)

    if (valid.length > 0) {
      console.log(`  ${c('green')}${valid.length}${c('reset')} variables configured`)
    }

    if (missingRequired.length > 0) {
      console.log(
        `  ${c('red')}${missingRequired.length}${c('reset')} required missing: ${missingRequired.map((v) => v.name).join(', ')}`
      )
    }

    if (missingOptional.length > 0) {
      console.log(
        `  ${c('yellow')}${missingOptional.length}${c('reset')} optional missing: ${missingOptional.map((v) => v.name).join(', ')}`
      )
    }

    if (overrides.size > 0) {
      const overrideNames = Array.from(overrides.keys())
      console.log(
        `  ${c('magenta')}${overrides.size}${c('reset')} overriding shared: ${overrideNames.join(', ')}`
      )
    }

    if (deprecated.length > 0) {
      console.log(`  ${c('dim')}${deprecated.length} deprecated: ${deprecated.join(', ')}${c('reset')}`)
    }

    if (extra.length > 0) {
      console.log(`  ${c('dim')}${extra.length} extra (not in schema): ${extra.join(', ')}${c('reset')}`)
    }

    console.log('')
  }
}

// =============================================================================
// Help Messages
// =============================================================================

/**
 * Print help for next steps
 */
export function printNextSteps(hasWarnings: boolean, command: string = 'env-doctor'): void {
  if (hasWarnings) {
    console.log(`${c('dim')}Run '${command} status' to see full report.${c('reset')}`)
    console.log('')
  }
}

/**
 * Print nothing to do message
 */
export function printNothingToDo(): void {
  console.log(`${s('check')} All environment variables are configured.`)
  console.log('')
}

// =============================================================================
// Box Drawing
// =============================================================================

/**
 * Draw a simple box around content
 */
function drawBox(title: string, lines: string[]): string {
  const maxLen = Math.max(title.length + 4, ...lines.map((l) => l.length)) + 4
  const top = `╭${'─'.repeat(maxLen)}╮`
  const titleLine = `│ ${title}${' '.repeat(maxLen - title.length - 2)} │`
  const separator = `├${'─'.repeat(maxLen)}┤`
  const bottom = `╰${'─'.repeat(maxLen)}╯`

  const contentLines = lines.map((line) => `│  ${line}${' '.repeat(maxLen - line.length - 3)} │`)

  return [top, titleLine, separator, ...contentLines, bottom].join('\n')
}

/**
 * Print a boxed postinstall message
 */
function printPostinstallBox(contentLines: string[], isOk: boolean): void {
  const title = 'env-doctor'
  const lines = [...contentLines]

  if (!isOk) {
    lines.push('')
    lines.push('To configure, run from repo root or any app:')
    lines.push('  env-doctor sync')
  }

  console.log('')
  console.log(drawBox(title, lines))
  console.log('')
}

/**
 * Print postinstall summary when action is needed
 */
export function printPostinstallActionNeeded(
  missingRequired: number,
  missingOptional: number
): void {
  const lines: string[] = []

  if (missingRequired > 0) {
    lines.push(`! ${missingRequired} required variable${missingRequired !== 1 ? 's' : ''} missing`)
  }
  if (missingOptional > 0) {
    lines.push(`${missingOptional} optional variable${missingOptional !== 1 ? 's' : ''} missing`)
  }

  printPostinstallBox(lines, false)
}

/**
 * Print postinstall all OK message
 */
export function printPostinstallOk(): void {
  printPostinstallBox(['Environment ready'], true)
}

// =============================================================================
// CI Mode
// =============================================================================

/**
 * Print CI mode header
 */
export function printCiHeader(): void {
  console.log(`${s('doctor')} ${c('bright')}env-doctor${c('reset')} ${c('dim')}(CI)${c('reset')}`)
  console.log('')
}

/**
 * Print CI checking section header
 */
export function printCiCheckingSection(name: string): void {
  console.log(`Checking ${c('cyan')}${name}${c('reset')}...`)
}

/**
 * Print CI variable present
 */
export function printCiPresent(name: string): void {
  console.log(`  ${s('check')} ${name}`)
}

/**
 * Print CI variable missing (required)
 */
export function printCiMissingRequired(name: string): void {
  console.log(`  ${s('error')} ${name} ${c('red')}(missing, required)${c('reset')}`)
}

/**
 * Print CI variable missing (optional)
 */
export function printCiMissingOptional(name: string): void {
  console.log(`  ${c('dim')}-${c('reset')} ${name} ${c('dim')}(missing, optional)${c('reset')}`)
}

/**
 * Print CI variable skipped (local-only directive)
 */
export function printCiSkipped(name: string, reason: string): void {
  console.log(`  ${c('dim')}-${c('reset')} ${name} ${c('dim')}(${reason})${c('reset')}`)
}

/**
 * Print CI summary
 */
export function printCiSummary(
  appName: string,
  checkedCount: number,
  missingRequired: number,
  missingOptional: number
): void {
  console.log('')
  if (missingRequired > 0) {
    console.log(
      `${s('error')} ${c('red')}${missingRequired} required variable${missingRequired !== 1 ? 's' : ''} missing. Build will fail.${c('reset')}`
    )
  } else {
    console.log(
      `${s('check')} ${c('green')}All ${checkedCount} required variables present for ${appName}.${c('reset')}`
    )
  }
  if (missingOptional > 0) {
    console.log(
      `${c('dim')}${missingOptional} optional variable${missingOptional !== 1 ? 's' : ''} not set.${c('reset')}`
    )
  }
  console.log('')
}

// =============================================================================
// Diagnose Mode
// =============================================================================

/**
 * Print diagnose header
 */
export function printDiagnoseHeader(): void {
  console.log('')
  console.log(`${s('doctor')} ${c('bright')}env-doctor diagnose${c('reset')}`)
  console.log('')
}

/**
 * Print diagnose scanning progress
 */
export function printDiagnoseScanning(target: string): void {
  console.log(`Scanning ${c('cyan')}${target}${c('reset')}...`)
}

/**
 * Print diagnose scan complete
 */
export function printDiagnoseScanComplete(filesScanned: number, varsFound: number): void {
  console.log(
    `  ${s('check')} Scanned ${filesScanned} files, found ${varsFound} env variable references`
  )
  console.log('')
}

/**
 * Print diagnose missing variable (used in code but not in schema)
 */
export function printDiagnoseMissing(
  name: string,
  usageCount: number,
  firstUsage: { file: string; line: number }
): void {
  console.log(
    `  ${s('warning')} ${c('yellow')}${name}${c('reset')} ${c('dim')}(${usageCount} usage${usageCount !== 1 ? 's' : ''}, first: ${firstUsage.file}:${firstUsage.line})${c('reset')}`
  )
}

/**
 * Print diagnose unused variable (in schema but not used in code)
 */
export function printDiagnoseUnused(name: string): void {
  console.log(`  ${c('dim')}-${c('reset')} ${name} ${c('dim')}(not found in source)${c('reset')}`)
}

/**
 * Print diagnose section header
 */
export function printDiagnoseSection(title: string): void {
  console.log(`${c('bright')}${title}${c('reset')}`)
}

/**
 * Print diagnose no issues found
 */
export function printDiagnoseNoIssues(section: string): void {
  console.log(`  ${s('check')} ${section}`)
}

/**
 * Print diagnose summary
 */
export function printDiagnoseSummary(
  missingCount: number,
  unusedCount: number,
  definedCount: number
): void {
  console.log('')
  console.log(`${c('bright')}Summary:${c('reset')}`)
  console.log(`  ${s('check')} ${definedCount} variable${definedCount !== 1 ? 's' : ''} properly defined`)

  if (missingCount > 0) {
    console.log(
      `  ${s('warning')} ${c('yellow')}${missingCount}${c('reset')} variable${missingCount !== 1 ? 's' : ''} used but not in .env.example`
    )
  }

  if (unusedCount > 0) {
    console.log(
      `  ${s('info')} ${unusedCount} variable${unusedCount !== 1 ? 's' : ''} in schema but not used in code`
    )
  }

  console.log('')
}

/**
 * Print diagnose next steps
 */
export function printDiagnoseNextSteps(hasMissing: boolean, exampleFileName: string = '.env.example'): void {
  if (hasMissing) {
    console.log(`${c('dim')}Add missing variables to the appropriate ${exampleFileName} file:${c('reset')}`)
    console.log(`  ${c('dim')}- Root ${exampleFileName} for shared variables${c('reset')}`)
    console.log(`  ${c('dim')}- apps/[app]/${exampleFileName} for app-specific variables${c('reset')}`)
    console.log('')
  }
}

/**
 * Print diagnose usage location
 */
export function printDiagnoseUsageLocation(file: string, line: number, pattern: string): void {
  console.log(`    ${c('dim')}${file}:${line} → ${pattern}${c('reset')}`)
}

// =============================================================================
// Plugin Messages
// =============================================================================

/**
 * Print plugin not available warning
 */
export function printPluginNotAvailable(pluginName: string, message: string): void {
  console.log('')
  console.log(`${s('info')} ${c('dim')}${pluginName}: ${message}${c('reset')}`)
  console.log('')
}

/**
 * Print plugin action
 */
export function printPluginAction(pluginName: string, action: string): void {
  console.log(`${s('info')} ${c('cyan')}[${pluginName}]${c('reset')} ${action}`)
}
