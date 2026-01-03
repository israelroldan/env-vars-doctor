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

function createContext(overrides: Partial<ResolverContext> = {}): ResolverContext {
  return {
    existingValues: new Map(),
    allDefinitions: [],
    interactive: true,
    rootDir: '/project',
    ...overrides,
  }
}

function createFetchResponse(data: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  })
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

        expect(provider.isAvailable!()).toBe(true)
      })

      it('should return false when no token', () => {
        delete process.env.VERCEL_TOKEN
        delete process.env.VERCEL_ACCESS_TOKEN
        const plugin = createVercelPlugin()
        const provider = plugin.deploymentProviders![0]

        expect(provider.isAvailable!()).toBe(false)
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
        mockFetch
          .mockResolvedValueOnce(createFetchResponse({ envs: [] })) // getProjectEnvVars
          .mockResolvedValueOnce(createFetchResponse({ id: 'new-id' })) // POST create

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
          'https://api.vercel.com/v10/projects/prj_abc123/env',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('VAR1'),
          })
        )
      })

      it('should update existing env var', async () => {
        mockFetch
          .mockResolvedValueOnce(
            createFetchResponse({ envs: [{ key: 'VAR1', value: 'old', target: ['production'] }] })
          )
          .mockResolvedValueOnce(createFetchResponse({ id: 'updated' })) // PATCH update

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
          'https://api.vercel.com/v9/projects/prj_abc123/env/VAR1',
          expect.objectContaining({
            method: 'PATCH',
          })
        )
      })

      it('should deploy to preview target', async () => {
        mockFetch
          .mockResolvedValueOnce(createFetchResponse({ envs: [] }))
          .mockResolvedValueOnce(createFetchResponse({ id: 'new-id' }))

        const plugin = createVercelPlugin({
          projectMapping: { web: 'prj_abc123' },
        })
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')
        const variables = new Map([['VAR1', 'value1']])
        const target = { name: 'preview', id: 'prj_abc123' }

        await provider.deploy(app, variables, target, createContext())

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining('"target":["preview"]'),
          })
        )
      })

      it('should deploy to development target', async () => {
        mockFetch
          .mockResolvedValueOnce(createFetchResponse({ envs: [] }))
          .mockResolvedValueOnce(createFetchResponse({ id: 'new-id' }))

        const plugin = createVercelPlugin({
          projectMapping: { web: 'prj_abc123' },
        })
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')
        const variables = new Map([['VAR1', 'value1']])
        const target = { name: 'development', id: 'prj_abc123' }

        await provider.deploy(app, variables, target, createContext())

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining('"target":["development"]'),
          })
        )
      })

      it('should deploy multiple variables', async () => {
        mockFetch.mockResolvedValue(createFetchResponse({ envs: [] }))

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

      it('should handle API error when fetching env vars', async () => {
        mockFetch.mockResolvedValueOnce(createFetchResponse({}, false, 401))

        const plugin = createVercelPlugin({
          projectMapping: { web: 'prj_abc123' },
        })
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')
        const variables = new Map([['VAR1', 'value1']])
        const target = { name: 'production', id: 'prj_abc123' }

        const result = await provider.deploy(app, variables, target, createContext())

        expect(result.success).toBe(false)
        expect(result.message).toContain('Failed to get env vars')
      })

      it('should handle API error when creating env var', async () => {
        mockFetch
          .mockResolvedValueOnce(createFetchResponse({ envs: [] }))
          .mockResolvedValueOnce(createFetchResponse({}, false, 500))

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

      it('should handle API error when updating env var', async () => {
        mockFetch
          .mockResolvedValueOnce(
            createFetchResponse({ envs: [{ key: 'VAR1', value: 'old', target: ['production'] }] })
          )
          .mockResolvedValueOnce(createFetchResponse({}, false, 500))

        const plugin = createVercelPlugin({
          projectMapping: { web: 'prj_abc123' },
        })
        const provider = plugin.deploymentProviders![0]
        const app = createAppInfo('web')
        const variables = new Map([['VAR1', 'new-value']])
        const target = { name: 'production', id: 'prj_abc123' }

        const result = await provider.deploy(app, variables, target, createContext())

        expect(result.success).toBe(false)
        expect(result.message).toContain('Failed to update VAR1')
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
