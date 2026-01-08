/**
 * Scanner for finding workspaces and their environment files
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { glob } from 'glob'
import type { AppInfo, EnvDoctorConfig, WorkspaceDetection } from './types.js'

// =============================================================================
// Root Detection
// =============================================================================

/**
 * Check if a directory is configured as a monorepo
 * Returns true if workspace config files are present (pnpm-workspace.yaml,
 * package.json with workspaces, or lerna.json)
 */
function isMonorepo(rootDir: string): boolean {
  // Check for pnpm workspace
  if (fs.existsSync(path.join(rootDir, 'pnpm-workspace.yaml'))) {
    return true
  }

  // Check for npm/yarn workspaces in package.json
  const packageJsonPath = path.join(rootDir, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      if (packageJson.workspaces) {
        return true
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Check for lerna
  if (fs.existsSync(path.join(rootDir, 'lerna.json'))) {
    return true
  }

  return false
}

/**
 * Detect the monorepo root by looking for workspace config files.
 * For single-projects (no workspace config), returns the nearest ancestor
 * containing a package.json.
 */
export function detectMonorepoRoot(startDir?: string): string {
  const originalCwd = startDir || process.cwd()
  let dir = originalCwd
  const { root } = path.parse(dir)

  // Track the first package.json we find (for single-project fallback)
  let firstPackageJsonDir: string | null = null

  // Walk up until filesystem root
  while (true) {
    // Check for pnpm workspace
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    // Check for npm/yarn workspaces in package.json
    const packageJsonPath = path.join(dir, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      // Track first package.json for single-project fallback
      if (firstPackageJsonDir === null) {
        firstPackageJsonDir = dir
      }
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
        if (packageJson.workspaces) {
          return dir
        }
      } catch {
        // Ignore parse errors
      }
    }
    // Check for lerna
    if (fs.existsSync(path.join(dir, 'lerna.json'))) {
      return dir
    }

    if (dir === root) {
      break
    }
    dir = path.dirname(dir)
  }

  // For single-projects, return the nearest ancestor with package.json
  // This allows running from subdirectories (e.g., src/) to still find the root
  if (firstPackageJsonDir !== null) {
    return firstPackageJsonDir
  }

  // Fallback to original cwd
  return originalCwd
}

/**
 * Get the root directory, using config or auto-detection
 */
export function getProjectRoot(config: EnvDoctorConfig, startDir?: string): string {
  // Could add explicit root in config later
  return detectMonorepoRoot(startDir)
}

/**
 * Create an AppInfo for the root directory (single-project mode)
 */
function createRootAppInfo(rootDir: string, config: EnvDoctorConfig): AppInfo {
  const envExampleName = config.project?.rootEnvExample || '.env.local.example'
  const envLocalName = config.project?.rootEnvLocal || '.env.local'
  const name = path.basename(rootDir) || 'root'

  return {
    name,
    path: rootDir,
    envExamplePath: path.join(rootDir, envExampleName),
    envLocalPath: path.join(rootDir, envLocalName),
  }
}

// =============================================================================
// Workspace Detection
// =============================================================================

/**
 * Detect workspace patterns from package manager config
 */
function detectWorkspacePatterns(rootDir: string, detection: WorkspaceDetection): string[] {
  if (detection === 'manual') {
    return []
  }

  // Check pnpm
  if (detection === 'auto' || detection === 'pnpm') {
    const pnpmWorkspacePath = path.join(rootDir, 'pnpm-workspace.yaml')
    if (fs.existsSync(pnpmWorkspacePath)) {
      try {
        const content = fs.readFileSync(pnpmWorkspacePath, 'utf-8')
        // Simple YAML parsing for packages array
        const packagesMatch = content.match(/packages:\s*\n((?:\s+-\s+['"]?[^\n]+['"]?\n?)+)/m)
        if (packagesMatch) {
          const patterns = packagesMatch[1]
            .split('\n')
            .map((line) => line.replace(/^\s+-\s+['"]?/, '').replace(/['"]?\s*$/, ''))
            .filter((p) => p.length > 0)
          if (patterns.length > 0) {
            return patterns
          }
        }
      } catch {
        // Fall through to defaults
      }
    }
  }

  // Check npm/yarn workspaces in package.json
  if (detection === 'auto' || detection === 'npm' || detection === 'yarn') {
    const packageJsonPath = path.join(rootDir, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
        if (Array.isArray(packageJson.workspaces)) {
          return packageJson.workspaces
        }
        if (packageJson.workspaces?.packages) {
          return packageJson.workspaces.packages
        }
      } catch {
        // Fall through to defaults
      }
    }
  }

  // Default patterns
  return ['apps/*', 'packages/*']
}

// =============================================================================
// Workspace Scanning
// =============================================================================

/**
 * Scan for all workspaces in the monorepo
 */
export async function scanWorkspaces(
  config: EnvDoctorConfig,
  rootDir?: string
): Promise<AppInfo[]> {
  const root = rootDir || getProjectRoot(config)
  const workspaceConfig = config.project?.workspaces || {}

  // Get patterns from config or detect from package manager
  const patterns =
    workspaceConfig.patterns && workspaceConfig.patterns.length > 0
      ? workspaceConfig.patterns
      : detectWorkspacePatterns(root, workspaceConfig.detection || 'auto')

  const apps: AppInfo[] = []

  for (const pattern of patterns) {
    // Use glob to find matching directories
    const matches = await glob(pattern, {
      cwd: root,
      absolute: false,
      nodir: false,
    })

    // Filter to only directories
    const dirMatches = matches.filter((match) => {
      const fullPath = path.join(root, match)
      try {
        return fs.statSync(fullPath).isDirectory()
      } catch {
        return false
      }
    })

    for (const match of dirMatches) {
      const appPath = path.join(root, match)
      const appName = path.basename(match)
      const packageJsonPath = path.join(appPath, 'package.json')

      // Must have package.json to be considered a workspace
      if (!fs.existsSync(packageJsonPath)) continue

      // Get env file names from config
      const envExampleName = config.project?.rootEnvExample || '.env.local.example'
      const envLocalName = config.project?.rootEnvLocal || '.env.local'

      apps.push({
        name: appName,
        path: appPath,
        envExamplePath: path.join(appPath, envExampleName),
        envLocalPath: path.join(appPath, envLocalName),
      })
    }
  }

  // Single-project fallback: if no workspaces found and this is not a monorepo,
  // treat the root directory as the target app (if it has .env.local.example)
  if (apps.length === 0 && !isMonorepo(root)) {
    const rootApp = createRootAppInfo(root, config)
    if (fs.existsSync(rootApp.envExamplePath)) {
      return [rootApp]
    }
  }

  // Sort alphabetically for consistent output
  return apps.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Synchronous version of scanWorkspaces for simpler use cases
 */
export function scanWorkspacesSync(
  config: EnvDoctorConfig,
  rootDir?: string
): AppInfo[] {
  const root = rootDir || getProjectRoot(config)
  const workspaceConfig = config.project?.workspaces || {}

  // Get patterns from config or detect from package manager
  const patterns =
    workspaceConfig.patterns && workspaceConfig.patterns.length > 0
      ? workspaceConfig.patterns
      : detectWorkspacePatterns(root, workspaceConfig.detection || 'auto')

  const apps: AppInfo[] = []

  for (const pattern of patterns) {
    // Simple glob matching for common patterns like "apps/*"
    const parts = pattern.split('/')
    if (parts.length === 2 && parts[1] === '*') {
      const baseDir = path.join(root, parts[0])
      if (!fs.existsSync(baseDir)) continue

      const entries = fs.readdirSync(baseDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const appPath = path.join(baseDir, entry.name)
        const packageJsonPath = path.join(appPath, 'package.json')

        // Must have package.json to be considered a workspace
        if (!fs.existsSync(packageJsonPath)) continue

        // Get env file names from config
        const envExampleName = config.project?.rootEnvExample || '.env.local.example'
        const envLocalName = config.project?.rootEnvLocal || '.env.local'

        apps.push({
          name: entry.name,
          path: appPath,
          envExamplePath: path.join(appPath, envExampleName),
          envLocalPath: path.join(appPath, envLocalName),
        })
      }
    }
  }

  // Single-project fallback: if no workspaces found and this is not a monorepo,
  // treat the root directory as the target app (if it has .env.local.example)
  if (apps.length === 0 && !isMonorepo(root)) {
    const rootApp = createRootAppInfo(root, config)
    if (fs.existsSync(rootApp.envExamplePath)) {
      return [rootApp]
    }
  }

  // Sort alphabetically for consistent output
  return apps.sort((a, b) => a.name.localeCompare(b.name))
}

// =============================================================================
// Root Env Paths
// =============================================================================

/**
 * Get paths to root-level env files
 */
export function getRootEnvPaths(
  config: EnvDoctorConfig,
  rootDir?: string
): {
  examplePath: string
  localPath: string
} {
  const root = rootDir || getProjectRoot(config)
  const envExampleName = config.project?.rootEnvExample || '.env.local.example'
  const envLocalName = config.project?.rootEnvLocal || '.env.local'

  return {
    examplePath: path.join(root, envExampleName),
    localPath: path.join(root, envLocalName),
  }
}

// =============================================================================
// App Utilities
// =============================================================================

/**
 * Check if an app has a .env.local.example file
 */
export function hasEnvExample(app: AppInfo): boolean {
  return fs.existsSync(app.envExamplePath)
}

/**
 * Check if an app has a .env.local file
 */
export function hasEnvLocal(app: AppInfo): boolean {
  return fs.existsSync(app.envLocalPath)
}

/**
 * Get all apps that have .env.local.example files
 */
export async function getWorkspacesWithSchema(
  config: EnvDoctorConfig,
  rootDir?: string
): Promise<AppInfo[]> {
  const apps = await scanWorkspaces(config, rootDir)
  return apps.filter(hasEnvExample)
}

/**
 * Find a specific app by name
 */
export async function findWorkspace(
  appName: string,
  config: EnvDoctorConfig,
  rootDir?: string
): Promise<AppInfo | null> {
  const apps = await scanWorkspaces(config, rootDir)
  return apps.find((app) => app.name === appName) || null
}

/**
 * Detect which app we're currently in based on CWD
 * Returns null if not in an app directory
 */
export async function detectCurrentWorkspace(
  config: EnvDoctorConfig,
  rootDir?: string
): Promise<AppInfo | null> {
  const root = rootDir || getProjectRoot(config)
  const cwd = process.cwd()

  // Must be inside root
  if (!cwd.startsWith(root)) {
    return null
  }

  const apps = await scanWorkspaces(config, root)

  // Find the app whose path is a prefix of cwd
  for (const app of apps) {
    if (cwd === app.path || cwd.startsWith(app.path + path.sep)) {
      return app
    }
  }

  return null
}
