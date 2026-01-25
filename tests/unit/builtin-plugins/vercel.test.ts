import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import {
  createVercelPlugin,
  isVercelAvailable,
  getVercelToken,
} from '@/builtin-plugins/vercel/index.js'
import type { AppInfo, ResolverContext } from '@/core/types.js'

// Mock fs
vi.mock('node:fs')

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Helpers
function createAppInfo(name: string): AppInfo {
  return {
    name,
    path: `/apps/${name}`,
    envExamplePath: `/apps/${name}/.env.example`,
    envLocalPath: `/apps/${name}/.env.local`,
  }
}

function createDefaultConfig() {
  return {
    version: '1' as const,
    project: {
      rootEnvExample: '.env.example',
      rootEnvLocal: '.env.local',
      workspaces: { detection: 'auto' as const, patterns: [], sourceDir: 'src' },
    },
    scanning: {
      extensions: ['.ts'],
      skipDirs: ['node_modules'],
      ignoreMissing: [],
      ignoreUnused: [],
    },
    ci: {
      skipEnvVar: 'SKIP_ENV_DOCTOR',
      skipDirectives: ['local-only', 'prompt'],
      detection: {},
    },
    plugins: {},
  }
}

function createContext(overrides: Partial<ResolverContext> = {}): ResolverContext {
  return {
    app: createAppInfo('test'),
    currentValues: new Map(),
    interactive: true,
    config: createDefaultConfig(),
    rootDir: '/project',
    ...overrides,
  } as ResolverContext
}

function createFetchResponse(data: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

/**
 * Extract the parsed request body from a mock fetch call
 */
function getRequestBody(callIndex = 0): Record<string, unknown> {
  const call = mockFetch.mock.calls[callIndex]
  if (!call || !call[1]?.body) {
    throw new Error(`No fetch call found at index ${callIndex}`)
  }
  return JSON.parse(call[1].body as string)
}

describe('vercel plugin', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetAllMocks()
    process.env = { ...originalEnv }
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.readFileSync).mockReturnValue('')
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe('getVercelToken', () => {
    it('should return VERCEL_TOKEN when set', () => {
      process.env.VERCEL_TOKEN = 'test-token'
      delete process.env.VERCEL_ACCESS_TOKEN

      expect(getVercelToken()).toBe('test-token')
    })

    it('should return VERCEL_ACCESS_TOKEN as fallback', () => {
      delete process.env.VERCEL_TOKEN
      process.env.VERCEL_ACCESS_TOKEN = 'access-token'

      expect(getVercelToken()).toBe('access-token')
    })

    it('should prefer VERCEL_TOKEN over VERCEL_ACCESS_TOKEN', () => {
      process.env.VERCEL_TOKEN = 'primary-token'
      process.env.VERCEL_ACCESS_TOKEN = 'fallback-token'

      expect(getVercelToken()).toBe('primary-token')
    })

    it('should return undefined when no token is set', () => {
      delete process.env.VERCEL_TOKEN
      delete process.env.VERCEL_ACCESS_TOKEN

      expect(getVercelToken()).toBeUndefined()
    })
  })

  describe('isVercelAvailable', () => {
    it('should return true when token is available', () => {
      process.env.VERCEL_TOKEN = 'test-token'

      expect(isVercelAvailable()).toBe(true)
    })

    it('should return false when no token', () => {
      delete process.env.VERCEL_TOKEN
      delete process.env.VERCEL_ACCESS_TOKEN

      expect(isVercelAvailable()).toBe(false)
    })
  })

  describe('createVercelPlugin', () => {
    it('should return plugin with correct metadata', () => {
      const plugin = createVercelPlugin()

      expect(plugin.meta.name).toBe('env-vars-doctor-plugin-vercel')
      expect(plugin.meta.version).toBe('1.0.0')
      expect(plugin.meta.description).toContain('Vercel')
    })

    it('should include deployment provider', () => {
      const plugin = createVercelPlugin()

      expect(plugin.deploymentProviders).toHaveLength(1)
      expect(plugin.deploymentProviders![0].name).toBe('vercel')
    })

    it('should include ignored platform variables', () => {
      const plugin = createVercelPlugin()

      expect(plugin.ignoreMissing).toContain('VERCEL')
      expect(plugin.ignoreMissing).toContain('VERCEL_ENV')
      expect(plugin.ignoreMissing).toContain('VERCEL_URL')
      expect(plugin.ignoreMissing).toContain('VERCEL_GIT_COMMIT_SHA')
    })

    it('should accept project mapping config', () => {
      const plugin = createVercelPlugin({
        projectMapping: {
          web: 'prj_abc123',
          api: 'prj_def456',
        },
      })

      expect(plugin).toBeDefined()
    })

    it('should accept project mapping source config', () => {
      const plugin = createVercelPlugin({
        projectMappingSource: '.github/workflows/deploy.yml',
      })

      expect(plugin).toBeDefined()
    })
  })

  describe('deployment provider', () => {
    describe('isAvailable', () => {
      it('should return true when token is set', () => {
        process.env.VERCEL_TOKEN = 'test-token'
        const plugin = createVercelPlugin()
        const provider = plugin.deploymentProviders![0]

        expect(provider.isAvailable!(createContext())).toBe(true)
      })

      it('should return false when no token', () => {
        delete process.env.VERCEL_TOKEN
        delete process.env.VERCEL_ACCESS_TOKEN
        const plugin = createVercelPlugin()
        const provider = plugin.deploymentProviders![0]

        expect(provider.isAvailable!(createContext())).toBe(false)
      })

      it('should have unavailable message', () => {
        const plugin = createVercelPlugin()
        const provider = plugin.deploymentProviders![0]

        expect(provider.unavailableMessage).toContain('VERCEL_TOKEN')
      })
    })

    describe('getTargets', () => {
      it('should return empty when no project mapping', async () => {
        const plugin = createVercelPlugin()
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')

        const targets = await provider.getTargets(app, createContext())

        expect(targets).toEqual([])
      })

      it('should return targets when project is mapped via config', async () => {
        const plugin = createVercelPlugin({
          projectMapping: { web: 'prj_abc123' },
        })
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')

        const targets = await provider.getTargets(app, createContext())

        expect(targets).toHaveLength(3)
        expect(targets[0]).toEqual({ name: 'production', id: 'prj_abc123' })
        expect(targets[1]).toEqual({ name: 'preview', id: 'prj_abc123' })
        expect(targets[2]).toEqual({ name: 'development', id: 'prj_abc123' })
      })

      it('should return targets when project is mapped via source file', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('["web"]="prj_xyz789"')

        const plugin = createVercelPlugin({
          projectMappingSource: '.github/workflows/deploy.yml',
        })
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')

        const targets = await provider.getTargets(app, createContext())

        expect(targets).toHaveLength(3)
        expect(targets[0].id).toBe('prj_xyz789')
      })

      it('should parse bash associative array format', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue(`
          ["web"]="prj_web123"
          ["api"]="prj_api456"
        `)

        const plugin = createVercelPlugin({
          projectMappingSource: '.github/workflows/deploy.yml',
        })
        const provider = plugin.deploymentProviders![0]

        const webTargets = await provider.getTargets(createAppInfo('web'), createContext())
        const apiTargets = await provider.getTargets(createAppInfo('api'), createContext())

        expect(webTargets[0].id).toBe('prj_web123')
        expect(apiTargets[0].id).toBe('prj_api456')
      })

      it('should parse simple key=value format', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue(`
          web: prj_webkey
          api: prj_apikey
        `)

        const plugin = createVercelPlugin({
          projectMappingSource: '.github/workflows/deploy.yml',
        })
        const provider = plugin.deploymentProviders![0]

        const webTargets = await provider.getTargets(createAppInfo('web'), createContext())

        expect(webTargets[0].id).toBe('prj_webkey')
      })

      it('should return empty when source file does not exist', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false)

        const plugin = createVercelPlugin({
          projectMappingSource: '.github/workflows/deploy.yml',
        })
        const provider = plugin.deploymentProviders![0]

        const targets = await provider.getTargets(createAppInfo('web'), createContext())

        expect(targets).toEqual([])
      })
    })

    describe('deploy', () => {
      beforeEach(() => {
        process.env.VERCEL_TOKEN = 'test-token'
      })

      it('should fail when no project mapping', async () => {
        const plugin = createVercelPlugin()
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')
        const variables = new Map([['VAR1', 'value1']])
        const target = { name: 'production', id: 'prj_abc' }

        const result = await provider.deploy(app, variables, target, createContext())

        expect(result.success).toBe(false)
        expect(result.message).toContain('No Vercel project ID configured')
      })

      it('should create new env var when it does not exist', async () => {
        mockFetch.mockResolvedValueOnce(createFetchResponse({ created: [{ id: 'new-id' }] }))

        const plugin = createVercelPlugin({
          projectMapping: { web: 'prj_abc123' },
        })
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')
        const variables = new Map([['VAR1', 'value1']])
        const target = { name: 'production', id: 'prj_abc123' }

        const result = await provider.deploy(app, variables, target, createContext())

        expect(result.success).toBe(true)
        expect(result.message).toContain('Deployed 1 variables')
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.vercel.com/v10/projects/prj_abc123/env?upsert=true',
          expect.objectContaining({
            method: 'POST',
          })
        )

        // Validate exact request body schema for project-level env vars
        const body = getRequestBody()
        expect(body).toEqual({
          key: 'VAR1',
          value: 'value1',
          target: ['production'],
          type: 'encrypted',
        })
        // Ensure we're NOT using the evs wrapper (that's for team-level only)
        expect(body).not.toHaveProperty('evs')
      })

      it('should update existing env var via upsert', async () => {
        mockFetch.mockResolvedValueOnce(createFetchResponse({ created: [{ id: 'updated' }] }))

        const plugin = createVercelPlugin({
          projectMapping: { web: 'prj_abc123' },
        })
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')
        const variables = new Map([['VAR1', 'new-value']])
        const target = { name: 'production', id: 'prj_abc123' }

        const result = await provider.deploy(app, variables, target, createContext())

        expect(result.success).toBe(true)
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.vercel.com/v10/projects/prj_abc123/env?upsert=true',
          expect.objectContaining({
            method: 'POST',
          })
        )

        // Validate exact request body schema
        const body = getRequestBody()
        expect(body).toEqual({
          key: 'VAR1',
          value: 'new-value',
          target: ['production'],
          type: 'encrypted',
        })
      })

      it('should deploy to preview target', async () => {
        mockFetch.mockResolvedValueOnce(createFetchResponse({ created: [{ id: 'new-id' }] }))

        const plugin = createVercelPlugin({
          projectMapping: { web: 'prj_abc123' },
        })
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')
        const variables = new Map([['VAR1', 'value1']])
        const target = { name: 'preview', id: 'prj_abc123' }

        await provider.deploy(app, variables, target, createContext())

        // Validate exact request body schema with preview target
        const body = getRequestBody()
        expect(body).toEqual({
          key: 'VAR1',
          value: 'value1',
          target: ['preview'],
          type: 'encrypted',
        })
      })

      it('should deploy to development target', async () => {
        mockFetch.mockResolvedValueOnce(createFetchResponse({ created: [{ id: 'new-id' }] }))

        const plugin = createVercelPlugin({
          projectMapping: { web: 'prj_abc123' },
        })
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')
        const variables = new Map([['VAR1', 'value1']])
        const target = { name: 'development', id: 'prj_abc123' }

        await provider.deploy(app, variables, target, createContext())

        // Validate exact request body schema with development target
        const body = getRequestBody()
        expect(body).toEqual({
          key: 'VAR1',
          value: 'value1',
          target: ['development'],
          type: 'encrypted',
        })
      })

      it('should deploy multiple variables', async () => {
        mockFetch.mockResolvedValue(createFetchResponse({ created: [{ id: 'new-id' }] }))

        const plugin = createVercelPlugin({
          projectMapping: { web: 'prj_abc123' },
        })
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')
        const variables = new Map([
          ['VAR1', 'value1'],
          ['VAR2', 'value2'],
          ['VAR3', 'value3'],
        ])
        const target = { name: 'production', id: 'prj_abc123' }

        const result = await provider.deploy(app, variables, target, createContext())

        expect(result.success).toBe(true)
        expect(result.message).toContain('Deployed 3 variables')
      })

      it('should handle API error when creating env var', async () => {
        mockFetch.mockResolvedValueOnce(createFetchResponse({}, false, 500))

        const plugin = createVercelPlugin({
          projectMapping: { web: 'prj_abc123' },
        })
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')
        const variables = new Map([['VAR1', 'value1']])
        const target = { name: 'production', id: 'prj_abc123' }

        const result = await provider.deploy(app, variables, target, createContext())

        expect(result.success).toBe(false)
        expect(result.message).toContain('Failed to create VAR1')
      })

      it('should handle API error with 401 unauthorized', async () => {
        mockFetch.mockResolvedValueOnce(createFetchResponse({}, false, 401))

        const plugin = createVercelPlugin({
          projectMapping: { web: 'prj_abc123' },
        })
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')
        const variables = new Map([['VAR1', 'new-value']])
        const target = { name: 'production', id: 'prj_abc123' }

        const result = await provider.deploy(app, variables, target, createContext())

        expect(result.success).toBe(false)
        expect(result.message).toContain('Failed to create VAR1')
      })

      it('should handle missing token error', async () => {
        delete process.env.VERCEL_TOKEN
        delete process.env.VERCEL_ACCESS_TOKEN

        const plugin = createVercelPlugin({
          projectMapping: { web: 'prj_abc123' },
        })
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')
        const variables = new Map([['VAR1', 'value1']])
        const target = { name: 'production', id: 'prj_abc123' }

        const result = await provider.deploy(app, variables, target, createContext())

        expect(result.success).toBe(false)
        expect(result.message).toContain('VERCEL_TOKEN')
      })
    })
  })

  describe('project mapping caching', () => {
    it('should cache parsed project mapping', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('["web"]="prj_cached"')

      const plugin = createVercelPlugin({
        projectMappingSource: '.github/workflows/deploy.yml',
      })
      const provider = plugin.deploymentProviders![0]

      await provider.getTargets(createAppInfo('web'), createContext())
      await provider.getTargets(createAppInfo('web'), createContext())
      await provider.getTargets(createAppInfo('web'), createContext())

      // Should only read file once due to caching
      expect(fs.readFileSync).toHaveBeenCalledTimes(1)
    })

    it('should reset cache when creating new plugin', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce('["web"]="prj_first"')
        .mockReturnValueOnce('["web"]="prj_second"')

      // First plugin
      const plugin1 = createVercelPlugin({
        projectMappingSource: '.github/workflows/deploy.yml',
      })
      const targets1 = await plugin1.deploymentProviders![0].getTargets(
        createAppInfo('web'),
        createContext()
      )

      // Second plugin - should clear cache
      const plugin2 = createVercelPlugin({
        projectMappingSource: '.github/workflows/deploy.yml',
      })
      const targets2 = await plugin2.deploymentProviders![0].getTargets(
        createAppInfo('web'),
        createContext()
      )

      expect(targets1[0].id).toBe('prj_first')
      expect(targets2[0].id).toBe('prj_second')
    })
  })
})
