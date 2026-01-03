import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_CONFIG,
  isCI,
  shouldSkip,
  getDetectedPlatform,
  defineConfig,
  loadConfig,
  loadConfigFromFile,
} from '@/core/config.js'
import type { EnvDoctorConfig } from '@/core/types.js'

// Mock cosmiconfig
vi.mock('cosmiconfig', () => ({
  cosmiconfig: vi.fn(),
}))

// Mock cosmiconfig-typescript-loader
vi.mock('cosmiconfig-typescript-loader', () => ({
  TypeScriptLoader: vi.fn(() => vi.fn()),
}))

import { cosmiconfig } from 'cosmiconfig'

describe('config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    // Clear any CI-related env vars
    delete process.env.CI
    delete process.env.GITHUB_ACTIONS
    delete process.env.VERCEL
    delete process.env.NETLIFY
    delete process.env.CONTINUOUS_INTEGRATION
    delete process.env.SKIP_ENV_DOCTOR
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('DEFAULT_CONFIG', () => {
    it('should have version 1', () => {
      expect(DEFAULT_CONFIG.version).toBe('1')
    })

    it('should have default project config', () => {
      expect(DEFAULT_CONFIG.project.rootEnvExample).toBe('.env.local.example')
      expect(DEFAULT_CONFIG.project.rootEnvLocal).toBe('.env.local')
    })

    it('should have default workspace config', () => {
      expect(DEFAULT_CONFIG.project.workspaces!.detection).toBe('auto')
      expect(DEFAULT_CONFIG.project.workspaces!.patterns).toContain('apps/*')
      expect(DEFAULT_CONFIG.project.workspaces!.patterns).toContain('packages/*')
      expect(DEFAULT_CONFIG.project.workspaces!.sourceDir).toBe('src')
    })

    it('should have default scanning config', () => {
      expect(DEFAULT_CONFIG.scanning.extensions).toContain('.ts')
      expect(DEFAULT_CONFIG.scanning.extensions).toContain('.tsx')
      expect(DEFAULT_CONFIG.scanning.skipDirs).toContain('node_modules')
      expect(DEFAULT_CONFIG.scanning.skipDirs).toContain('dist')
    })

    it('should have default CI config', () => {
      expect(DEFAULT_CONFIG.ci.skipEnvVar).toBe('SKIP_ENV_DOCTOR')
      expect(DEFAULT_CONFIG.ci.skipDirectives).toContain('local-only')
      expect(DEFAULT_CONFIG.ci.skipDirectives).toContain('prompt')
    })

    it('should have CI detection config', () => {
      expect(DEFAULT_CONFIG.ci.detection!.ci).toContain('CI')
      expect(DEFAULT_CONFIG.ci.detection!.github).toContain('GITHUB_ACTIONS')
      expect(DEFAULT_CONFIG.ci.detection!.vercel).toContain('VERCEL')
      expect(DEFAULT_CONFIG.ci.detection!.netlify).toContain('NETLIFY')
    })
  })

  describe('isCI', () => {
    it('should return false when no CI env vars are set', () => {
      expect(isCI(DEFAULT_CONFIG)).toBe(false)
    })

    it('should return true when CI env var is set', () => {
      process.env.CI = 'true'
      expect(isCI(DEFAULT_CONFIG)).toBe(true)
    })

    it('should return true when GITHUB_ACTIONS is set', () => {
      process.env.GITHUB_ACTIONS = 'true'
      expect(isCI(DEFAULT_CONFIG)).toBe(true)
    })

    it('should return true when VERCEL is set', () => {
      process.env.VERCEL = '1'
      expect(isCI(DEFAULT_CONFIG)).toBe(true)
    })

    it('should return true when NETLIFY is set', () => {
      process.env.NETLIFY = 'true'
      expect(isCI(DEFAULT_CONFIG)).toBe(true)
    })

    it('should return true when CONTINUOUS_INTEGRATION is set', () => {
      process.env.CONTINUOUS_INTEGRATION = 'true'
      expect(isCI(DEFAULT_CONFIG)).toBe(true)
    })

    it('should work with custom detection config', () => {
      const config = {
        ...DEFAULT_CONFIG,
        ci: {
          ...DEFAULT_CONFIG.ci,
          detection: { custom: ['MY_CI_VAR'] },
        },
      }
      process.env.MY_CI_VAR = 'true'
      expect(isCI(config)).toBe(true)
    })
  })

  describe('shouldSkip', () => {
    it('should return false when skip env var is not set', () => {
      expect(shouldSkip(DEFAULT_CONFIG)).toBe(false)
    })

    it('should return true when SKIP_ENV_DOCTOR is set', () => {
      process.env.SKIP_ENV_DOCTOR = '1'
      expect(shouldSkip(DEFAULT_CONFIG)).toBe(true)
    })

    it('should return true when skip env var is set to any truthy value', () => {
      process.env.SKIP_ENV_DOCTOR = 'true'
      expect(shouldSkip(DEFAULT_CONFIG)).toBe(true)
    })

    it('should work with custom skip env var', () => {
      const config = {
        ...DEFAULT_CONFIG,
        ci: {
          ...DEFAULT_CONFIG.ci,
          skipEnvVar: 'CUSTOM_SKIP_VAR',
        },
      }
      process.env.CUSTOM_SKIP_VAR = '1'
      expect(shouldSkip(config)).toBe(true)
    })
  })

  describe('getDetectedPlatform', () => {
    it('should return null when no CI env vars are set', () => {
      expect(getDetectedPlatform(DEFAULT_CONFIG)).toBeNull()
    })

    it('should detect GitHub Actions', () => {
      process.env.GITHUB_ACTIONS = 'true'
      expect(getDetectedPlatform(DEFAULT_CONFIG)).toBe('github')
    })

    it('should detect Vercel', () => {
      process.env.VERCEL = '1'
      expect(getDetectedPlatform(DEFAULT_CONFIG)).toBe('vercel')
    })

    it('should detect Netlify', () => {
      process.env.NETLIFY = 'true'
      expect(getDetectedPlatform(DEFAULT_CONFIG)).toBe('netlify')
    })

    it('should detect generic CI', () => {
      process.env.CI = 'true'
      expect(getDetectedPlatform(DEFAULT_CONFIG)).toBe('ci')
    })

    it('should return first matching platform when multiple are set', () => {
      process.env.CI = 'true'
      process.env.GITHUB_ACTIONS = 'true'
      // The order depends on Object.entries iteration, but it should return one of them
      const platform = getDetectedPlatform(DEFAULT_CONFIG)
      expect(['ci', 'github']).toContain(platform)
    })
  })

  describe('defineConfig', () => {
    it('should return the same config object (passthrough)', () => {
      const config: EnvDoctorConfig = {
        version: '1',
        project: {
          rootEnvExample: '.env.example',
        },
      }

      const result = defineConfig(config)

      expect(result).toBe(config)
      expect(result.version).toBe('1')
      expect(result.project?.rootEnvExample).toBe('.env.example')
    })

    it('should work with empty config', () => {
      const config: EnvDoctorConfig = {}
      const result = defineConfig(config)
      expect(result).toEqual({})
    })

    it('should work with full config', () => {
      const config: EnvDoctorConfig = {
        version: '1',
        project: {
          rootEnvExample: '.env.example',
          rootEnvLocal: '.env',
          workspaces: {
            detection: 'pnpm',
            patterns: ['apps/*'],
            sourceDir: 'lib',
          },
        },
        scanning: {
          extensions: ['.ts'],
          skipDirs: ['build'],
          ignoreMissing: ['NODE_ENV'],
          ignoreUnused: ['DEBUG'],
        },
        ci: {
          skipEnvVar: 'SKIP',
          skipDirectives: ['prompt'],
        },
      }

      const result = defineConfig(config)
      expect(result).toEqual(config)
    })
  })

  describe('loadConfig', () => {
    beforeEach(() => {
      vi.resetAllMocks()
    })

    it('should return default config when no config file found', async () => {
      const mockExplorer = {
        search: vi.fn().mockResolvedValue(null),
      }
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as any)

      const result = await loadConfig()

      expect(result.found).toBe(false)
      expect(result.filepath).toBeNull()
      expect(result.config.version).toBe('1')
    })

    it('should return default config when config is empty', async () => {
      const mockExplorer = {
        search: vi.fn().mockResolvedValue({ isEmpty: true, config: {}, filepath: '/test/.env-vars-doctorrc' }),
      }
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as any)

      const result = await loadConfig()

      expect(result.found).toBe(false)
    })

    it('should merge user config with defaults', async () => {
      const userConfig: EnvDoctorConfig = {
        version: '1',
        project: {
          rootEnvExample: '.env.example',
        },
      }
      const mockExplorer = {
        search: vi.fn().mockResolvedValue({
          isEmpty: false,
          config: userConfig,
          filepath: '/test/env-vars-doctor.config.ts',
        }),
      }
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as any)

      const result = await loadConfig()

      expect(result.found).toBe(true)
      expect(result.filepath).toBe('/test/env-vars-doctor.config.ts')
      expect(result.config.project.rootEnvExample).toBe('.env.example')
      // Should still have default values for unspecified fields
      expect(result.config.project.rootEnvLocal).toBe('.env.local')
    })

    it('should search from specific directory', async () => {
      const mockExplorer = {
        search: vi.fn().mockResolvedValue(null),
      }
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as any)

      await loadConfig('/custom/path')

      expect(mockExplorer.search).toHaveBeenCalledWith('/custom/path')
    })

    it('should throw on config file syntax errors', async () => {
      const mockExplorer = {
        search: vi.fn().mockRejectedValue(new Error('Syntax error in config')),
      }
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as any)

      await expect(loadConfig()).rejects.toThrow('Failed to load env-vars-doctor config')
    })

    it('should deep merge nested config objects', async () => {
      const userConfig: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
        scanning: {
          extensions: ['.ts'],
        },
      }
      const mockExplorer = {
        search: vi.fn().mockResolvedValue({
          isEmpty: false,
          config: userConfig,
          filepath: '/test/config.ts',
        }),
      }
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as any)

      const result = await loadConfig()

      // User-specified values
      expect(result.config.project.workspaces!.patterns).toEqual(['apps/*'])
      expect(result.config.scanning.extensions).toEqual(['.ts'])
      // Default values for unspecified nested fields
      expect(result.config.project.workspaces!.detection).toBe('auto')
      expect(result.config.project.workspaces!.sourceDir).toBe('src')
    })

    it('should handle CI config override', async () => {
      const userConfig: EnvDoctorConfig = {
        ci: {
          skipEnvVar: 'MY_SKIP_VAR',
          detection: {
            custom: ['MY_CI'],
          },
        },
      }
      const mockExplorer = {
        search: vi.fn().mockResolvedValue({
          isEmpty: false,
          config: userConfig,
          filepath: '/test/config.ts',
        }),
      }
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as any)

      const result = await loadConfig()

      expect(result.config.ci.skipEnvVar).toBe('MY_SKIP_VAR')
      expect(result.config.ci.detection!.custom).toEqual(['MY_CI'])
    })
  })

  describe('loadConfigFromFile', () => {
    beforeEach(() => {
      vi.resetAllMocks()
    })

    it('should load config from specific file', async () => {
      const userConfig: EnvDoctorConfig = {
        version: '1',
        project: {
          rootEnvExample: '.env.schema',
        },
      }
      const mockExplorer = {
        load: vi.fn().mockResolvedValue({
          isEmpty: false,
          config: userConfig,
          filepath: '/project/custom-config.ts',
        }),
      }
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as any)

      const result = await loadConfigFromFile('/project/custom-config.ts')

      expect(mockExplorer.load).toHaveBeenCalledWith('/project/custom-config.ts')
      expect(result.found).toBe(true)
      expect(result.config.project.rootEnvExample).toBe('.env.schema')
    })

    it('should return default config when file is empty', async () => {
      const mockExplorer = {
        load: vi.fn().mockResolvedValue({ isEmpty: true, config: {}, filepath: '/test/config.ts' }),
      }
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as any)

      const result = await loadConfigFromFile('/test/config.ts')

      expect(result.found).toBe(false)
      expect(result.filepath).toBe('/test/config.ts')
    })

    it('should return default config when file returns null', async () => {
      const mockExplorer = {
        load: vi.fn().mockResolvedValue(null),
      }
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as any)

      const result = await loadConfigFromFile('/test/missing.ts')

      expect(result.found).toBe(false)
    })

    it('should throw on file load errors', async () => {
      const mockExplorer = {
        load: vi.fn().mockRejectedValue(new Error('File not found')),
      }
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as any)

      await expect(loadConfigFromFile('/missing/config.ts')).rejects.toThrow(
        'Failed to load env-vars-doctor config from /missing/config.ts'
      )
    })
  })
})
