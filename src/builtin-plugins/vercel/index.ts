/**
 * Vercel bundled plugin
 *
 * Deploys environment variables to Vercel projects
 */

import * as fs from 'node:fs'
import type {
  EnvDoctorPlugin,
  DeploymentProvider,
  DeploymentTarget,
  AppInfo,
  ResolverContext,
  VercelPluginConfig,
} from '../../core/types.js'

// =============================================================================
// State
// =============================================================================

let pluginConfig: VercelPluginConfig = {}
let parsedProjectMapping: Record<string, string> | null = null

// =============================================================================
// Project Mapping Parser
// =============================================================================

/**
 * Parse project mapping from a source file (e.g., GitHub Actions workflow)
 *
 * Supports formats:
 * - Bash associative array: ["app-name"]="prj_xxx"
 * - YAML/JSON-like: app-name: prj_xxx
 */
function parseProjectMappingSource(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const mapping: Record<string, string> = {}

  // Pattern 1: Bash associative array format
  // ["app-name"]="prj_xxx"
  const bashPattern = /\["([^"]+)"\]\s*=\s*"(prj_[^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = bashPattern.exec(content)) !== null) {
    mapping[match[1]] = match[2]
  }

  // Pattern 2: Simple key=value format
  // APP_NAME: prj_xxx
  if (Object.keys(mapping).length === 0) {
    const simplePattern = /([a-z][\w-]*)\s*[:=]\s*(prj_\w+)/gi
    while ((match = simplePattern.exec(content)) !== null) {
      mapping[match[1].toLowerCase()] = match[2]
    }
  }

  return mapping
}

/**
 * Get the resolved project mapping (from config or parsed source)
 */
function getProjectMapping(): Record<string, string> {
  // Use explicit mapping if provided
  if (pluginConfig.projectMapping) {
    return pluginConfig.projectMapping
  }

  // Parse from source file if configured
  if (pluginConfig.projectMappingSource && parsedProjectMapping === null) {
    parsedProjectMapping = parseProjectMappingSource(pluginConfig.projectMappingSource)
  }

  return parsedProjectMapping || {}
}

// =============================================================================
// Vercel API
// =============================================================================

/**
 * Get Vercel API token from environment
 */
function getVercelToken(): string | undefined {
  return process.env.VERCEL_TOKEN || process.env.VERCEL_ACCESS_TOKEN
}

/**
 * Check if Vercel token is available
 */
function isVercelAvailable(): boolean {
  return !!getVercelToken()
}

/**
 * Get Vercel project ID for an app
 */
function getProjectId(appName: string): string | undefined {
  const mapping = getProjectMapping()
  return mapping[appName]
}

/**
 * Make a Vercel API request
 */
async function vercelRequest(
  method: string,
  endpoint: string,
  body?: unknown
): Promise<Response> {
  const token = getVercelToken()
  if (!token) {
    throw new Error('VERCEL_TOKEN environment variable is not set')
  }

  const response = await fetch(`https://api.vercel.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  return response
}

/**
 * Create or update an environment variable
 * Uses upsert=true to create or update in a single call
 */
async function upsertEnvVar(
  projectId: string,
  key: string,
  value: string,
  target: DeploymentTarget
): Promise<void> {
  const targets: ('production' | 'preview' | 'development')[] =
    target.name === 'production'
      ? ['production']
      : target.name === 'preview'
        ? ['preview']
        : ['development']

  // Use upsert=true to create or update in a single call
  // Project-level v10 endpoint expects a single object (not evs array)
  const response = await vercelRequest('POST', `/v10/projects/${projectId}/env?upsert=true`, {
    key,
    value,
    target: targets,
    type: 'encrypted',
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Failed to create ${key} (${targets.join(', ')}): ${response.status} ${response.statusText} ${errorBody}`)
  }
}

// =============================================================================
// Deployment Provider
// =============================================================================

/**
 * Vercel deployment provider
 */
const vercelDeploymentProvider: DeploymentProvider = {
  name: 'vercel',

  async getTargets(app: AppInfo, _context: ResolverContext): Promise<DeploymentTarget[]> {
    const projectId = getProjectId(app.name)
    if (!projectId) {
      return []
    }

    return [
      { name: 'production', id: projectId },
      { name: 'preview', id: projectId },
      { name: 'development', id: projectId },
    ]
  },

  async deploy(
    app: AppInfo,
    variables: Map<string, string>,
    target: DeploymentTarget,
    _context: ResolverContext
  ): Promise<{ success: boolean; message: string }> {
    const projectId = getProjectId(app.name)
    if (!projectId) {
      return {
        success: false,
        message: `No Vercel project ID configured for ${app.name}`,
      }
    }

    try {
      let updated = 0
      for (const [key, value] of variables) {
        await upsertEnvVar(projectId, key, value, target)
        updated++
      }

      return {
        success: true,
        message: `Deployed ${updated} variables to ${app.name} (${target.name})`,
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  },

  isAvailable: () => isVercelAvailable(),
  unavailableMessage: 'VERCEL_TOKEN environment variable is not set',
}

// =============================================================================
// Plugin Factory
// =============================================================================

/**
 * Vercel platform variables (auto-injected by Vercel)
 */
const VERCEL_PLATFORM_VARIABLES = [
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_REGION',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_GIT_COMMIT_REF',
  'VERCEL_GIT_COMMIT_MESSAGE',
  'VERCEL_GIT_COMMIT_AUTHOR_LOGIN',
  'VERCEL_GIT_COMMIT_AUTHOR_NAME',
  'VERCEL_GIT_PROVIDER',
  'VERCEL_GIT_REPO_ID',
  'VERCEL_GIT_REPO_OWNER',
  'VERCEL_GIT_REPO_SLUG',
  'VERCEL_GIT_PULL_REQUEST_ID',
]

/**
 * Create the Vercel plugin
 */
export function createVercelPlugin(config: VercelPluginConfig = {}): EnvDoctorPlugin {
  pluginConfig = config
  parsedProjectMapping = null // Reset parsed mapping for new config

  return {
    meta: {
      name: 'env-vars-doctor-plugin-vercel',
      version: '1.0.0',
      description: 'Deploy environment variables to Vercel projects',
    },
    deploymentProviders: [vercelDeploymentProvider],
    ignoreMissing: VERCEL_PLATFORM_VARIABLES,
  }
}

// =============================================================================
// Exports
// =============================================================================

export { isVercelAvailable, getVercelToken }
