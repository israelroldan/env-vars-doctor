import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as childProcess from 'node:child_process'
import {
  createSupabasePlugin,
  isSupabaseCliInstalled,
  isSupabaseRunning,
  clearCache,
} from '@/builtin-plugins/supabase/index.js'
import type { EnvVarDefinition, ResolverContext } from '@/core/types.js'

// Mock child_process
vi.mock('node:child_process')

// Mock scanner
vi.mock('@/core/scanner.js', () => ({
  detectMonorepoRoot: vi.fn(() => '/project'),
}))

// Helpers
function createVarDef(name: string, exampleValue = ''): EnvVarDefinition {
  return {
    name,
    exampleValue,
    requirement: 'required',
    directive: { type: 'supabase' },
    description: '',
    rawComment: '',
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

function createSupabaseStatus(overrides: Record<string, string> = {}) {
  return {
    API_URL: 'http://127.0.0.1:54321',
    ANON_KEY: 'test-anon-key',
    SERVICE_ROLE_KEY: 'test-service-role-key',
    DB_URL: 'postgresql://localhost:54322/postgres',
    STUDIO_URL: 'http://127.0.0.1:54323',
    INBUCKET_URL: 'http://127.0.0.1:54324',
    JWT_SECRET: 'test-jwt-secret',
    ...overrides,
  }
}

describe('supabase plugin', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.resetAllMocks()
    clearCache()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    vi.restoreAllMocks()
  })

  describe('isSupabaseCliInstalled', () => {
    it('should return true when CLI is installed (unix)', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      vi.mocked(childProcess.execSync).mockReturnValue('/usr/local/bin/supabase')

      // Create plugin to reset cache
      createSupabasePlugin()

      expect(isSupabaseCliInstalled()).toBe(true)
      expect(childProcess.execSync).toHaveBeenCalledWith(
        'which supabase',
        expect.any(Object)
      )
    })

    it('should return true when CLI is installed (windows)', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      vi.mocked(childProcess.execSync).mockReturnValue('C:\\supabase\\supabase.exe')

      createSupabasePlugin()

      expect(isSupabaseCliInstalled()).toBe(true)
      expect(childProcess.execSync).toHaveBeenCalledWith(
        'where supabase',
        expect.any(Object)
      )
    })

    it('should return false when CLI is not installed', () => {
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('not found')
      })

      createSupabasePlugin()

      expect(isSupabaseCliInstalled()).toBe(false)
    })

    it('should cache the result', () => {
      vi.mocked(childProcess.execSync).mockReturnValue('/usr/local/bin/supabase')

      createSupabasePlugin()

      isSupabaseCliInstalled()
      isSupabaseCliInstalled()
      isSupabaseCliInstalled()

      // Should only call once due to caching
      expect(childProcess.execSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('isSupabaseRunning', () => {
    it('should return true when supabase is running', () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase') // which check
        .mockReturnValueOnce(JSON.stringify(createSupabaseStatus())) // status check

      createSupabasePlugin()

      expect(isSupabaseRunning()).toBe(true)
    })

    it('should return false when supabase is not running', () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase') // which check
        .mockImplementationOnce(() => {
          throw new Error('not running')
        }) // status check

      createSupabasePlugin()

      expect(isSupabaseRunning()).toBe(false)
    })

    it('should return false when CLI is not installed', () => {
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('not found')
      })

      createSupabasePlugin()

      expect(isSupabaseRunning()).toBe(false)
    })
  })

  describe('createSupabasePlugin', () => {
    it('should return plugin with correct metadata', () => {
      const plugin = createSupabasePlugin()

      expect(plugin.meta.name).toBe('env-vars-doctor-plugin-supabase')
      expect(plugin.meta.version).toBe('1.0.0')
      expect(plugin.meta.description).toContain('Supabase')
    })

    it('should include supabase source', () => {
      const plugin = createSupabasePlugin()

      expect(plugin.sources).toHaveLength(1)
      expect(plugin.sources![0].directiveType).toBe('supabase')
      expect(plugin.sources![0].pattern).toEqual(/\[supabase\]/i)
    })

    it('should clear cache when created', () => {
      // First check - set cache to installed
      vi.mocked(childProcess.execSync).mockReturnValue('/usr/local/bin/supabase')
      createSupabasePlugin()
      isSupabaseCliInstalled()

      // Now make it return "not found"
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('not found')
      })

      // Create new plugin - should clear cache
      createSupabasePlugin()

      // Should check again since cache was cleared
      expect(isSupabaseCliInstalled()).toBe(false)
    })

    it('should accept custom config', () => {
      const plugin = createSupabasePlugin({
        databaseDir: 'custom/db',
        variableMapping: {
          CUSTOM_VAR: 'api_url',
        },
      })

      expect(plugin).toBeDefined()
    })
  })

  describe('source.isAvailable', () => {
    it('should return true when CLI is installed', () => {
      vi.mocked(childProcess.execSync).mockReturnValue('/usr/local/bin/supabase')

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]

      expect(source.isAvailable!()).toBe(true)
    })

    it('should return false when CLI is not installed', () => {
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('not found')
      })

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]

      expect(source.isAvailable!()).toBe(false)
    })

    it('should have unavailable message', () => {
      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]

      expect(source.unavailableMessage).toContain('Supabase CLI not installed')
    })
  })

  describe('source.resolve', () => {
    it('should return placeholder when CLI is not installed', async () => {
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('not found')
      })

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]
      const result = await source.resolve(
        createVarDef('NEXT_PUBLIC_SUPABASE_URL'),
        createContext()
      )

      expect(result.value).toBe('http://127.0.0.1:54321')
      expect(result.source).toBe('placeholder')
      expect(result.warning).toContain('Supabase CLI not installed')
    })

    it('should return placeholder when supabase is not running', async () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase') // which check
        .mockImplementationOnce(() => {
          throw new Error('not running')
        }) // status check

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]
      const result = await source.resolve(
        createVarDef('NEXT_PUBLIC_SUPABASE_URL'),
        createContext()
      )

      expect(result.value).toBe('http://127.0.0.1:54321')
      expect(result.source).toBe('placeholder')
      expect(result.warning).toContain('Supabase not running')
    })

    it('should resolve NEXT_PUBLIC_SUPABASE_URL from status', async () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase')
        .mockReturnValueOnce(JSON.stringify(createSupabaseStatus()))

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]
      const result = await source.resolve(
        createVarDef('NEXT_PUBLIC_SUPABASE_URL'),
        createContext()
      )

      expect(result.value).toBe('http://127.0.0.1:54321')
      expect(result.source).toBe('supabase')
      expect(result.warning).toBeUndefined()
    })

    it('should resolve SUPABASE_URL from status', async () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase')
        .mockReturnValueOnce(JSON.stringify(createSupabaseStatus()))

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]
      const result = await source.resolve(createVarDef('SUPABASE_URL'), createContext())

      expect(result.value).toBe('http://127.0.0.1:54321')
      expect(result.source).toBe('supabase')
    })

    it('should resolve NEXT_PUBLIC_SUPABASE_ANON_KEY from status', async () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase')
        .mockReturnValueOnce(JSON.stringify(createSupabaseStatus()))

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]
      const result = await source.resolve(
        createVarDef('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
        createContext()
      )

      expect(result.value).toBe('test-anon-key')
      expect(result.source).toBe('supabase')
    })

    it('should resolve SUPABASE_SERVICE_ROLE_KEY from status', async () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase')
        .mockReturnValueOnce(JSON.stringify(createSupabaseStatus()))

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]
      const result = await source.resolve(
        createVarDef('SUPABASE_SERVICE_ROLE_KEY'),
        createContext()
      )

      expect(result.value).toBe('test-service-role-key')
      expect(result.source).toBe('supabase')
    })

    it('should resolve SUPABASE_JWT_SECRET from status', async () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase')
        .mockReturnValueOnce(JSON.stringify(createSupabaseStatus()))

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]
      const result = await source.resolve(
        createVarDef('SUPABASE_JWT_SECRET'),
        createContext()
      )

      expect(result.value).toBe('test-jwt-secret')
      expect(result.source).toBe('supabase')
    })

    it('should handle alternative key names in status', async () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase')
        .mockReturnValueOnce(
          JSON.stringify({
            api_url: 'http://localhost:54321',
            anon_key: 'lowercase-anon-key',
            service_role_key: 'lowercase-service-key',
          })
        )

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]
      const result = await source.resolve(
        createVarDef('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
        createContext()
      )

      expect(result.value).toBe('lowercase-anon-key')
      expect(result.source).toBe('supabase')
    })

    it('should handle PUBLISHABLE_KEY alias for anon key', async () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase')
        .mockReturnValueOnce(
          JSON.stringify({
            API_URL: 'http://localhost:54321',
            PUBLISHABLE_KEY: 'publishable-key-value',
          })
        )

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]
      const result = await source.resolve(
        createVarDef('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
        createContext()
      )

      expect(result.value).toBe('publishable-key-value')
      expect(result.source).toBe('supabase')
    })

    it('should handle SECRET_KEY alias for service role key', async () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase')
        .mockReturnValueOnce(
          JSON.stringify({
            API_URL: 'http://localhost:54321',
            SECRET_KEY: 'secret-key-value',
          })
        )

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]
      const result = await source.resolve(
        createVarDef('SUPABASE_SERVICE_ROLE_KEY'),
        createContext()
      )

      expect(result.value).toBe('secret-key-value')
      expect(result.source).toBe('supabase')
    })

    it('should return placeholder for unmapped variable', async () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase')
        .mockReturnValueOnce(JSON.stringify(createSupabaseStatus()))

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]
      const result = await source.resolve(
        createVarDef('UNKNOWN_VAR', 'default-value'),
        createContext()
      )

      expect(result.value).toBe('default-value')
      expect(result.source).toBe('placeholder')
      expect(result.warning).toContain('Could not fetch UNKNOWN_VAR')
    })

    it('should use custom variable mapping', async () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase')
        .mockReturnValueOnce(JSON.stringify(createSupabaseStatus()))

      const plugin = createSupabasePlugin({
        variableMapping: {
          MY_CUSTOM_URL: 'api_url',
        },
      })
      const source = plugin.sources![0]
      const result = await source.resolve(
        createVarDef('MY_CUSTOM_URL'),
        createContext()
      )

      expect(result.value).toBe('http://127.0.0.1:54321')
      expect(result.source).toBe('supabase')
    })

    it('should use custom database directory', async () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase')
        .mockReturnValueOnce(JSON.stringify(createSupabaseStatus()))

      const plugin = createSupabasePlugin({
        databaseDir: 'apps/db',
      })
      const source = plugin.sources![0]
      await source.resolve(createVarDef('SUPABASE_URL'), createContext())

      expect(childProcess.execSync).toHaveBeenCalledWith(
        'supabase status --output json',
        expect.objectContaining({
          cwd: '/project/apps/db',
        })
      )
    })

    it('should cache status across multiple resolves', async () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase')
        .mockReturnValueOnce(JSON.stringify(createSupabaseStatus()))

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]

      await source.resolve(createVarDef('SUPABASE_URL'), createContext())
      await source.resolve(createVarDef('NEXT_PUBLIC_SUPABASE_ANON_KEY'), createContext())
      await source.resolve(createVarDef('SUPABASE_SERVICE_ROLE_KEY'), createContext())

      // Should only call status once (plus the which check)
      expect(childProcess.execSync).toHaveBeenCalledTimes(2)
    })

    it('should use example value when no placeholder defined', async () => {
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('not found')
      })

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]
      const result = await source.resolve(
        createVarDef('UNKNOWN_VAR', 'my-example-value'),
        createContext()
      )

      expect(result.value).toBe('my-example-value')
    })

    it('should return empty string when no placeholder or example', async () => {
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('not found')
      })

      const plugin = createSupabasePlugin()
      const source = plugin.sources![0]
      const result = await source.resolve(createVarDef('UNKNOWN_VAR', ''), createContext())

      expect(result.value).toBe('')
    })
  })

  describe('clearCache', () => {
    it('should reset all cached state', () => {
      vi.mocked(childProcess.execSync)
        .mockReturnValueOnce('/usr/local/bin/supabase')
        .mockReturnValueOnce(JSON.stringify(createSupabaseStatus()))

      createSupabasePlugin()
      isSupabaseCliInstalled()
      isSupabaseRunning()

      // Clear cache
      clearCache()

      // Should check again after clearing
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('not found')
      })

      expect(isSupabaseCliInstalled()).toBe(false)
    })
  })
})
