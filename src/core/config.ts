/**
 * Configuration loading and management using cosmiconfig
 */

import { cosmiconfig, type CosmiconfigResult } from 'cosmiconfig'
import type {
  EnvDoctorConfig,
  ProjectConfig,
  WorkspaceConfig,
  ScanningConfig,
  CIConfig,
  PluginsConfig,
} from './types.js'

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_WORKSPACE_CONFIG: Required<WorkspaceConfig> = {
  detection: 'auto',
  patterns: ['apps/*', 'packages/*'],
  sourceDir: 'src',
}

const DEFAULT_SCANNING_CONFIG: Required<ScanningConfig> = {
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  skipDirs: ['node_modules', 'dist', '.next', 'build', 'coverage', '.git'],
  ignoreMissing: [],
  ignoreUnused: [],
}

const DEFAULT_CI_CONFIG: Required<CIConfig> = {
  skipEnvVar: 'SKIP_ENV_DOCTOR',
  skipDirectives: ['local-only', 'prompt'],
  detection: {
    ci: ['CI', 'CONTINUOUS_INTEGRATION'],
    github: ['GITHUB_ACTIONS'],
    vercel: ['VERCEL'],
    netlify: ['NETLIFY'],
  },
}

const DEFAULT_PROJECT_CONFIG: Required<ProjectConfig> = {
  rootEnvExample: '.env.local.example',
  rootEnvLocal: '.env.local',
  workspaces: DEFAULT_WORKSPACE_CONFIG,
}

const DEFAULT_PLUGINS_CONFIG: PluginsConfig = {
  supabase: { enabled: false },
  vercel: { enabled: false },
  external: [],
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: Required<EnvDoctorConfig> = {
  version: '1',
  project: DEFAULT_PROJECT_CONFIG,
  scanning: DEFAULT_SCANNING_CONFIG,
  ci: DEFAULT_CI_CONFIG,
  plugins: DEFAULT_PLUGINS_CONFIG,
}

// =============================================================================
// Configuration Loading
// =============================================================================

/**
 * Module name for cosmiconfig
 */
const MODULE_NAME = 'env-vars-doctor'

/**
 * Create the cosmiconfig explorer
 */
async function createExplorer() {
  // Dynamically import the TypeScript loader to avoid issues if not installed
  let TypeScriptLoader: typeof import('cosmiconfig-typescript-loader').TypeScriptLoader | undefined

  try {
    const module = await import('cosmiconfig-typescript-loader')
    TypeScriptLoader = module.TypeScriptLoader
  } catch {
    // TypeScript loader not available, will only support JS/JSON configs
  }

  const searchPlaces = [
    'package.json',
    `.${MODULE_NAME}rc`,
    `.${MODULE_NAME}rc.json`,
    `.${MODULE_NAME}rc.yaml`,
    `.${MODULE_NAME}rc.yml`,
    `.${MODULE_NAME}rc.js`,
    `.${MODULE_NAME}rc.cjs`,
    `.${MODULE_NAME}rc.mjs`,
    `${MODULE_NAME}.config.js`,
    `${MODULE_NAME}.config.cjs`,
    `${MODULE_NAME}.config.mjs`,
    `${MODULE_NAME}.config.ts`,
    `${MODULE_NAME}.config.mts`,
    `${MODULE_NAME}.config.cts`,
  ]

  if (TypeScriptLoader) {
    return cosmiconfig(MODULE_NAME, {
      searchPlaces,
      loaders: {
        '.ts': TypeScriptLoader(),
        '.mts': TypeScriptLoader(),
        '.cts': TypeScriptLoader(),
      },
    })
  }

  return cosmiconfig(MODULE_NAME, { searchPlaces })
}

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key]
    const targetValue = target[key]

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T]
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T]
    }
  }

  return result
}

/**
 * Merge user config with defaults
 */
function mergeWithDefaults(userConfig: EnvDoctorConfig): Required<EnvDoctorConfig> {
  return {
    version: userConfig.version ?? DEFAULT_CONFIG.version,
    project: deepMerge(
      DEFAULT_PROJECT_CONFIG as Record<string, unknown>,
      (userConfig.project ?? {}) as Record<string, unknown>
    ) as Required<ProjectConfig>,
    scanning: deepMerge(
      DEFAULT_SCANNING_CONFIG as Record<string, unknown>,
      (userConfig.scanning ?? {}) as Record<string, unknown>
    ) as Required<ScanningConfig>,
    ci: deepMerge(
      DEFAULT_CI_CONFIG as Record<string, unknown>,
      (userConfig.ci ?? {}) as Record<string, unknown>
    ) as Required<CIConfig>,
    plugins: deepMerge(
      DEFAULT_PLUGINS_CONFIG as Record<string, unknown>,
      (userConfig.plugins ?? {}) as Record<string, unknown>
    ) as PluginsConfig,
  }
}

/**
 * Load configuration result
 */
export interface LoadConfigResult {
  /** The merged configuration */
  config: Required<EnvDoctorConfig>
  /** Path to the config file (if found) */
  filepath: string | null
  /** Whether a config file was found */
  found: boolean
}

/**
 * Load configuration from the filesystem
 *
 * @param searchFrom - Directory to start searching from (default: cwd)
 * @returns The loaded and merged configuration
 */
export async function loadConfig(searchFrom?: string): Promise<LoadConfigResult> {
  const explorer = await createExplorer()

  let result: CosmiconfigResult = null

  try {
    result = searchFrom ? await explorer.search(searchFrom) : await explorer.search()
  } catch (error) {
    // Config file has syntax errors
    throw new Error(
      `Failed to load env-vars-doctor config: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (result === null || result.isEmpty) {
    return {
      config: DEFAULT_CONFIG,
      filepath: null,
      found: false,
    }
  }

  const userConfig = result.config as EnvDoctorConfig
  const mergedConfig = mergeWithDefaults(userConfig)

  return {
    config: mergedConfig,
    filepath: result.filepath,
    found: true,
  }
}

/**
 * Load configuration from a specific file
 *
 * @param filepath - Path to the config file
 * @returns The loaded and merged configuration
 */
export async function loadConfigFromFile(filepath: string): Promise<LoadConfigResult> {
  const explorer = await createExplorer()

  let result: CosmiconfigResult = null

  try {
    result = await explorer.load(filepath)
  } catch (error) {
    throw new Error(
      `Failed to load env-vars-doctor config from ${filepath}: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (result === null || result.isEmpty) {
    return {
      config: DEFAULT_CONFIG,
      filepath,
      found: false,
    }
  }

  const userConfig = result.config as EnvDoctorConfig
  const mergedConfig = mergeWithDefaults(userConfig)

  return {
    config: mergedConfig,
    filepath: result.filepath,
    found: true,
  }
}

// =============================================================================
// Config Helper
// =============================================================================

/**
 * Define an env-vars-doctor configuration with type checking
 *
 * @example
 * ```ts
 * // env-vars-doctor.config.ts
 * import { defineConfig } from 'env-vars-doctor'
 *
 * export default defineConfig({
 *   project: {
 *     workspaces: {
 *       patterns: ['apps/*'],
 *     },
 *   },
 * })
 * ```
 */
export function defineConfig(config: EnvDoctorConfig): EnvDoctorConfig {
  return config
}

// =============================================================================
// Environment Detection
// =============================================================================

/**
 * Check if running in CI environment
 */
export function isCI(config: Required<EnvDoctorConfig>): boolean {
  const detection = config.ci.detection ?? {}

  for (const envVars of Object.values(detection)) {
    for (const envVar of envVars) {
      if (process.env[envVar]) {
        return true
      }
    }
  }

  return false
}

/**
 * Check if env-vars-doctor should be skipped
 */
export function shouldSkip(config: Required<EnvDoctorConfig>): boolean {
  const skipVar = config.ci.skipEnvVar
  return skipVar ? !!process.env[skipVar] : false
}

/**
 * Get the detected CI platform
 */
export function getDetectedPlatform(
  config: Required<EnvDoctorConfig>
): string | null {
  const detection = config.ci.detection ?? {}

  for (const [platform, envVars] of Object.entries(detection)) {
    for (const envVar of envVars) {
      if (process.env[envVar]) {
        return platform
      }
    }
  }

  return null
}
