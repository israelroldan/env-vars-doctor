/**
 * Supabase bundled plugin
 *
 * Fetches environment variables from local Supabase instance
 */

import { execSync } from 'node:child_process'
import * as path from 'node:path'
import type {
  EnvDoctorPlugin,
  ValueSourceProvider,
  EnvVarDefinition,
  ResolvedValue,
  ResolverContext,
  SupabasePluginConfig,
} from '../../core/types.js'
import { detectMonorepoRoot } from '../../core/scanner.js'

// =============================================================================
// Types
// =============================================================================

interface SupabaseStatus {
  api_url?: string
  anon_key?: string
  service_role_key?: string
  db_url?: string
  studio_url?: string
  inbucket_url?: string
  jwt_secret?: string
}

// =============================================================================
// State
// =============================================================================

let cachedStatus: SupabaseStatus | null = null
let statusChecked = false
let supabaseCliAvailable: boolean | null = null
let pluginConfig: SupabasePluginConfig = {}

// =============================================================================
// CLI Detection
// =============================================================================

/**
 * Check if Supabase CLI is installed
 */
function isSupabaseCliInstalled(): boolean {
  if (supabaseCliAvailable !== null) {
    return supabaseCliAvailable
  }

  try {
    const isWindows = process.platform === 'win32'
    const checkCmd = isWindows ? 'where supabase' : 'which supabase'

    execSync(checkCmd, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    supabaseCliAvailable = true
    return true
  } catch {
    supabaseCliAvailable = false
    return false
  }
}

/**
 * Check if Supabase is running
 */
function isSupabaseRunning(): boolean {
  return getSupabaseStatus() !== null
}

// =============================================================================
// Status Fetching
// =============================================================================

/**
 * Get Supabase status from local instance
 */
function getSupabaseStatus(rootDir?: string): SupabaseStatus | null {
  if (statusChecked) {
    return cachedStatus
  }

  statusChecked = true

  if (!isSupabaseCliInstalled()) {
    cachedStatus = null
    return null
  }

  try {
    const root = rootDir || detectMonorepoRoot()
    const databaseDir = path.join(root, pluginConfig.databaseDir || 'packages/database')

    const output = execSync('supabase status --output json', {
      cwd: databaseDir,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const status = JSON.parse(output)

    // Map to our interface (Supabase CLI uses different key names)
    cachedStatus = {
      api_url: status.API_URL || status.api_url,
      anon_key:
        status.PUBLISHABLE_KEY ||
        status.publishable_key ||
        status.ANON_KEY ||
        status.anon_key,
      service_role_key:
        status.SECRET_KEY ||
        status.secret_key ||
        status.SERVICE_ROLE_KEY ||
        status.service_role_key,
      db_url: status.DB_URL || status.db_url,
      studio_url: status.STUDIO_URL || status.studio_url,
      inbucket_url: status.INBUCKET_URL || status.inbucket_url,
      jwt_secret: status.JWT_SECRET || status.jwt_secret,
    }

    return cachedStatus
  } catch {
    cachedStatus = null
    return null
  }
}

// =============================================================================
// Variable Mapping
// =============================================================================

/**
 * Default variable name to Supabase status field mapping
 */
const DEFAULT_VARIABLE_MAPPING: Record<string, keyof SupabaseStatus> = {
  NEXT_PUBLIC_SUPABASE_URL: 'api_url',
  SUPABASE_URL: 'api_url',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon_key',
  SUPABASE_ANON_KEY: 'anon_key',
  SUPABASE_SERVICE_ROLE_KEY: 'service_role_key',
  SUPABASE_JWT_SECRET: 'jwt_secret',
}

/**
 * Default placeholder values when Supabase is not running
 */
const PLACEHOLDER_VALUES: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'your_anon_key_here',
  SUPABASE_ANON_KEY: 'your_anon_key_here',
  SUPABASE_SERVICE_ROLE_KEY: 'your_service_role_key_here',
  SUPABASE_JWT_SECRET: 'your_jwt_secret_here',
}

/**
 * Get variable mapping with config overrides
 */
function getVariableMapping(): Record<string, string> {
  const customMapping = pluginConfig.variableMapping || {}
  return { ...DEFAULT_VARIABLE_MAPPING, ...customMapping }
}

// =============================================================================
// Value Resolution
// =============================================================================

/**
 * Resolve a Supabase-sourced variable
 */
async function resolveSupabaseValue(
  definition: EnvVarDefinition,
  context: ResolverContext
): Promise<ResolvedValue> {
  const placeholder = PLACEHOLDER_VALUES[definition.name] || definition.exampleValue || ''
  const databaseDir = pluginConfig.databaseDir || 'packages/database'

  // If Supabase CLI is not installed
  if (!isSupabaseCliInstalled()) {
    return {
      value: placeholder,
      source: 'placeholder',
      warning: `Supabase CLI not installed. Using placeholder for ${definition.name}. Install with 'brew install supabase/tap/supabase' then run 'env-doctor sync' again.`,
    }
  }

  const status = getSupabaseStatus(context.rootDir)

  // If Supabase is not running
  if (!status) {
    return {
      value: placeholder,
      source: 'placeholder',
      warning: `Supabase not running. Using placeholder for ${definition.name}. Run 'cd ${databaseDir} && pnpm db:start' then 'env-doctor sync' again.`,
    }
  }

  // Get the mapped field
  const mapping = getVariableMapping()
  const field = mapping[definition.name] as keyof SupabaseStatus | undefined
  if (field && status[field]) {
    return {
      value: status[field]!,
      source: 'supabase',
    }
  }

  // Unknown mapping or field not available
  return {
    value: definition.exampleValue || '',
    source: 'placeholder',
    warning: `Could not fetch ${definition.name} from Supabase status`,
  }
}

// =============================================================================
// Plugin Factory
// =============================================================================

/**
 * Create the Supabase plugin
 */
export function createSupabasePlugin(config: SupabasePluginConfig = {}): EnvDoctorPlugin {
  // Store config for use in resolver
  pluginConfig = config

  // Clear cached state when creating new plugin
  cachedStatus = null
  statusChecked = false
  supabaseCliAvailable = null

  const supabaseSource: ValueSourceProvider = {
    directiveType: 'supabase',
    pattern: /\[supabase\]/i,
    resolve: resolveSupabaseValue,
    isAvailable: () => isSupabaseCliInstalled(),
    unavailableMessage:
      "Supabase CLI not installed. Install with 'brew install supabase/tap/supabase'",
  }

  return {
    meta: {
      name: 'env-doctor-plugin-supabase',
      version: '1.0.0',
      description: 'Fetch environment variables from local Supabase instance',
    },
    sources: [supabaseSource],
  }
}

// =============================================================================
// Exports
// =============================================================================

export { isSupabaseCliInstalled, isSupabaseRunning }

/**
 * Clear cached status (for testing)
 */
export function clearCache(): void {
  cachedStatus = null
  statusChecked = false
  supabaseCliAvailable = null
}
