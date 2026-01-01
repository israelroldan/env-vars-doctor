/**
 * Source file scanner for detecting environment variable usage
 *
 * Scans source files for:
 * - process.env.KEY
 * - process.env["KEY"]
 * - process.env['KEY']
 * - import.meta.env.KEY
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AppInfo, EnvDoctorConfig, ScanningConfig } from './types.js'
import { getPluginIgnoreMissing } from '../plugins/registry.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Where an env variable is used
 */
export interface EnvUsage {
  /** File path (relative to app) */
  file: string
  /** Line number */
  line: number
  /** The matched pattern */
  pattern: string
}

/**
 * Result of scanning source files for env usage
 */
export interface SourceScanResult {
  /** Environment variables found in source files */
  usedVars: Map<string, EnvUsage[]>
  /** Total files scanned */
  filesScanned: number
  /** Total lines scanned */
  linesScanned: number
}

/**
 * Result of diagnosing env usage against schema
 */
export interface DiagnoseResult {
  /** Vars used in code but not in any .env.example */
  missing: Map<string, EnvUsage[]>
  /** Vars in .env.example but not used in code */
  unused: Set<string>
  /** Vars used and defined */
  defined: Set<string>
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'])

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  '.git',
  'coverage',
  '__snapshots__',
])

const DEFAULT_SKIP_FILES = new Set(['env-doctor.ts', 'env-doctor.js'])

// =============================================================================
// Regex Patterns
// =============================================================================

/**
 * Regex patterns to match env variable usage
 */
const ENV_PATTERNS = [
  // process.env.KEY (dot notation)
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  // process.env["KEY"] or process.env['KEY'] (bracket notation)
  /process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g,
  // import.meta.env.KEY (Vite-style)
  /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
]

// =============================================================================
// Scanning Helpers
// =============================================================================

/**
 * Get the set of extensions to scan
 */
function getExtensions(config: EnvDoctorConfig): Set<string> {
  const configExtensions = config.scanning?.extensions
  if (configExtensions && configExtensions.length > 0) {
    return new Set(configExtensions)
  }
  return DEFAULT_EXTENSIONS
}

/**
 * Get the set of directories to skip
 */
function getSkipDirs(config: EnvDoctorConfig): Set<string> {
  const configSkipDirs = config.scanning?.skipDirs
  if (configSkipDirs && configSkipDirs.length > 0) {
    return new Set(configSkipDirs)
  }
  return DEFAULT_SKIP_DIRS
}

/**
 * Built-in ignored missing vars (always ignored)
 */
const BUILTIN_IGNORED_MISSING = ['NODE_ENV']

/**
 * Get the set of ignored missing vars
 * Combines: built-in defaults + config + plugins
 */
function getIgnoredMissing(config: EnvDoctorConfig): Set<string> {
  const configIgnored = config.scanning?.ignoreMissing || []
  const pluginIgnored = getPluginIgnoreMissing()
  return new Set([...BUILTIN_IGNORED_MISSING, ...configIgnored, ...pluginIgnored])
}

/**
 * Get the set of ignored unused vars
 */
function getIgnoredUnused(config: EnvDoctorConfig): Set<string> {
  return new Set(config.scanning?.ignoreUnused || [])
}

/**
 * Check if a directory should be skipped
 */
function shouldSkipDir(name: string, skipDirs: Set<string>): boolean {
  return skipDirs.has(name) || name.startsWith('.')
}

/**
 * Check if a file should be scanned
 */
function shouldScanFile(filePath: string, extensions: Set<string>): boolean {
  const ext = path.extname(filePath)
  const name = path.basename(filePath)

  if (DEFAULT_SKIP_FILES.has(name)) {
    return false
  }

  return extensions.has(ext)
}

/**
 * Extract env variables from a line of code
 */
function extractEnvVars(line: string, lineNumber: number, relativePath: string): EnvUsage[] {
  const usages: EnvUsage[] = []

  for (const pattern of ENV_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = pattern.exec(line)) !== null) {
      usages.push({
        file: relativePath,
        line: lineNumber,
        pattern: match[0],
      })
    }
  }

  return usages
}

/**
 * Scan a single file for env variable usage
 */
function scanFile(filePath: string, relativePath: string, result: SourceScanResult): void {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  result.linesScanned += lines.length

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1

    const usages = extractEnvVars(line, lineNumber, relativePath)

    for (const usage of usages) {
      // Extract variable name from pattern
      let varName: string | null = null

      for (const pattern of ENV_PATTERNS) {
        pattern.lastIndex = 0
        const match = pattern.exec(usage.pattern)
        if (match) {
          varName = match[1]
          break
        }
      }

      if (varName) {
        if (!result.usedVars.has(varName)) {
          result.usedVars.set(varName, [])
        }
        result.usedVars.get(varName)!.push(usage)
      }
    }
  }
}

/**
 * Recursively scan a directory for source files
 */
function scanDirectory(
  dirPath: string,
  basePath: string,
  result: SourceScanResult,
  extensions: Set<string>,
  skipDirs: Set<string>
): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name, skipDirs)) {
        scanDirectory(fullPath, basePath, result, extensions, skipDirs)
      }
    } else if (entry.isFile() && shouldScanFile(entry.name, extensions)) {
      const relativePath = path.relative(basePath, fullPath)
      result.filesScanned++
      scanFile(fullPath, relativePath, result)
    }
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Scan an app's source files for env variable usage
 */
export function scanAppSources(app: AppInfo, config: EnvDoctorConfig): SourceScanResult {
  const result: SourceScanResult = {
    usedVars: new Map(),
    filesScanned: 0,
    linesScanned: 0,
  }

  const extensions = getExtensions(config)
  const skipDirs = getSkipDirs(config)
  const sourceDir = config.project?.workspaces?.sourceDir || 'src'

  // Scan the app's source directory if it exists
  const srcDir = path.join(app.path, sourceDir)
  if (fs.existsSync(srcDir)) {
    scanDirectory(srcDir, app.path, result, extensions, skipDirs)
  }

  // Also scan root-level files (next.config.js, etc.)
  const entries = fs.readdirSync(app.path, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isFile() && shouldScanFile(entry.name, extensions)) {
      const fullPath = path.join(app.path, entry.name)
      result.filesScanned++
      scanFile(fullPath, entry.name, result)
    }
  }

  return result
}

/**
 * Scan shared packages for env variable usage
 */
export function scanPackageSources(
  rootDir: string,
  config: EnvDoctorConfig
): SourceScanResult {
  const result: SourceScanResult = {
    usedVars: new Map(),
    filesScanned: 0,
    linesScanned: 0,
  }

  const extensions = getExtensions(config)
  const skipDirs = getSkipDirs(config)
  const sourceDir = config.project?.workspaces?.sourceDir || 'src'

  // Find packages directory from workspace patterns
  const patterns = config.project?.workspaces?.patterns || ['apps/*', 'packages/*']
  const packagePatterns = patterns.filter((p) => p.startsWith('packages'))

  for (const pattern of packagePatterns) {
    const packagesDir = path.join(rootDir, pattern.split('/')[0])
    if (!fs.existsSync(packagesDir)) continue

    const packages = fs.readdirSync(packagesDir, { withFileTypes: true })

    for (const pkg of packages) {
      if (!pkg.isDirectory()) continue

      const pkgPath = path.join(packagesDir, pkg.name)
      const srcDir = path.join(pkgPath, sourceDir)

      if (fs.existsSync(srcDir)) {
        scanDirectory(srcDir, pkgPath, result, extensions, skipDirs)
      }
    }
  }

  return result
}

/**
 * Merge multiple scan results
 */
export function mergeScanResults(results: SourceScanResult[]): SourceScanResult {
  const merged: SourceScanResult = {
    usedVars: new Map(),
    filesScanned: 0,
    linesScanned: 0,
  }

  for (const result of results) {
    merged.filesScanned += result.filesScanned
    merged.linesScanned += result.linesScanned

    for (const [varName, usages] of result.usedVars) {
      if (!merged.usedVars.has(varName)) {
        merged.usedVars.set(varName, [])
      }
      merged.usedVars.get(varName)!.push(...usages)
    }
  }

  return merged
}

/**
 * Check if an env var should be ignored in "missing" check
 */
export function isIgnoredMissingVar(varName: string, config: EnvDoctorConfig): boolean {
  const ignoredMissing = getIgnoredMissing(config)
  return ignoredMissing.has(varName)
}

/**
 * Check if an env var should be ignored in "unused" check
 */
export function isIgnoredUnusedVar(varName: string, config: EnvDoctorConfig): boolean {
  const ignoredUnused = getIgnoredUnused(config)
  return ignoredUnused.has(varName)
}

/**
 * Diagnose env variable usage against schema
 */
export function diagnoseEnvUsage(
  usedVars: Map<string, EnvUsage[]>,
  schemaVars: Set<string>,
  config: EnvDoctorConfig
): DiagnoseResult {
  const missing = new Map<string, EnvUsage[]>()
  const unused = new Set<string>()
  const defined = new Set<string>()

  const ignoredMissing = getIgnoredMissing(config)
  const ignoredUnused = getIgnoredUnused(config)

  // Find missing: used but not in schema (excluding ignored vars)
  for (const [varName, usages] of usedVars) {
    if (ignoredMissing.has(varName)) {
      // Skip system/platform-provided variables
      continue
    }

    if (schemaVars.has(varName)) {
      defined.add(varName)
    } else {
      missing.set(varName, usages)
    }
  }

  // Find unused: in schema but not used (excluding vars used by dependencies)
  for (const varName of schemaVars) {
    if (ignoredUnused.has(varName)) {
      // Skip variables used by dependencies internally
      continue
    }

    if (!usedVars.has(varName)) {
      unused.add(varName)
    }
  }

  return { missing, unused, defined }
}
