import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import {
  diagnoseEnvUsage,
  mergeScanResults,
  isIgnoredMissingVar,
  isIgnoredUnusedVar,
  scanAppSources,
  scanPackageSources,
} from '@/core/source-scanner.js'
import type { EnvDoctorConfig, AppInfo } from '@/core/types.js'
import type { SourceScanResult, EnvUsage } from '@/core/source-scanner.js'

// Mock fs module
vi.mock('node:fs')

// Mock the plugin registry
vi.mock('@/plugins/registry.js', () => ({
  getPluginIgnoreMissing: () => ['PLUGIN_VAR'],
}))

describe('source-scanner', () => {
  describe('diagnoseEnvUsage', () => {
    const defaultConfig: EnvDoctorConfig = {
      scanning: {
        ignoreMissing: [],
        ignoreUnused: [],
      },
    }

    it('should identify missing variables (used but not in schema)', () => {
      const usedVars = new Map<string, EnvUsage[]>([
        ['API_KEY', [{ file: 'src/api.ts', line: 10, pattern: 'process.env.API_KEY' }]],
        ['SECRET', [{ file: 'src/auth.ts', line: 5, pattern: 'process.env.SECRET' }]],
      ])
      const schemaVars = new Set(['API_KEY'])

      const result = diagnoseEnvUsage(usedVars, schemaVars, defaultConfig)

      expect(result.missing.size).toBe(1)
      expect(result.missing.has('SECRET')).toBe(true)
      expect(result.defined.has('API_KEY')).toBe(true)
    })

    it('should identify unused variables (in schema but not used)', () => {
      const usedVars = new Map<string, EnvUsage[]>([
        ['API_KEY', [{ file: 'src/api.ts', line: 10, pattern: 'process.env.API_KEY' }]],
      ])
      const schemaVars = new Set(['API_KEY', 'DATABASE_URL', 'REDIS_URL'])

      const result = diagnoseEnvUsage(usedVars, schemaVars, defaultConfig)

      expect(result.unused.size).toBe(2)
      expect(result.unused.has('DATABASE_URL')).toBe(true)
      expect(result.unused.has('REDIS_URL')).toBe(true)
    })

    it('should ignore NODE_ENV in missing check (built-in)', () => {
      const usedVars = new Map<string, EnvUsage[]>([
        ['NODE_ENV', [{ file: 'src/app.ts', line: 1, pattern: 'process.env.NODE_ENV' }]],
      ])
      const schemaVars = new Set<string>()

      const result = diagnoseEnvUsage(usedVars, schemaVars, defaultConfig)

      expect(result.missing.size).toBe(0)
    })

    it('should ignore PLUGIN_VAR in missing check (from plugin registry)', () => {
      const usedVars = new Map<string, EnvUsage[]>([
        ['PLUGIN_VAR', [{ file: 'src/app.ts', line: 1, pattern: 'process.env.PLUGIN_VAR' }]],
      ])
      const schemaVars = new Set<string>()

      const result = diagnoseEnvUsage(usedVars, schemaVars, defaultConfig)

      expect(result.missing.size).toBe(0)
    })

    it('should respect ignoreMissing config', () => {
      const usedVars = new Map<string, EnvUsage[]>([
        ['CUSTOM_VAR', [{ file: 'src/app.ts', line: 1, pattern: 'process.env.CUSTOM_VAR' }]],
      ])
      const schemaVars = new Set<string>()
      const config: EnvDoctorConfig = {
        scanning: {
          ignoreMissing: ['CUSTOM_VAR'],
        },
      }

      const result = diagnoseEnvUsage(usedVars, schemaVars, config)

      expect(result.missing.size).toBe(0)
    })

    it('should respect ignoreUnused config', () => {
      const usedVars = new Map<string, EnvUsage[]>()
      const schemaVars = new Set(['INTERNAL_VAR'])
      const config: EnvDoctorConfig = {
        scanning: {
          ignoreUnused: ['INTERNAL_VAR'],
        },
      }

      const result = diagnoseEnvUsage(usedVars, schemaVars, config)

      expect(result.unused.size).toBe(0)
    })

    it('should track defined variables (used and in schema)', () => {
      const usedVars = new Map<string, EnvUsage[]>([
        ['API_KEY', [{ file: 'src/api.ts', line: 10, pattern: 'process.env.API_KEY' }]],
        ['DATABASE_URL', [{ file: 'src/db.ts', line: 5, pattern: 'process.env.DATABASE_URL' }]],
      ])
      const schemaVars = new Set(['API_KEY', 'DATABASE_URL'])

      const result = diagnoseEnvUsage(usedVars, schemaVars, defaultConfig)

      expect(result.defined.size).toBe(2)
      expect(result.defined.has('API_KEY')).toBe(true)
      expect(result.defined.has('DATABASE_URL')).toBe(true)
      expect(result.missing.size).toBe(0)
      expect(result.unused.size).toBe(0)
    })
  })

  describe('mergeScanResults', () => {
    it('should merge empty results', () => {
      const results: SourceScanResult[] = []

      const merged = mergeScanResults(results)

      expect(merged.filesScanned).toBe(0)
      expect(merged.linesScanned).toBe(0)
      expect(merged.usedVars.size).toBe(0)
    })

    it('should merge single result', () => {
      const results: SourceScanResult[] = [
        {
          filesScanned: 10,
          linesScanned: 500,
          usedVars: new Map([
            ['API_KEY', [{ file: 'src/api.ts', line: 10, pattern: 'process.env.API_KEY' }]],
          ]),
        },
      ]

      const merged = mergeScanResults(results)

      expect(merged.filesScanned).toBe(10)
      expect(merged.linesScanned).toBe(500)
      expect(merged.usedVars.size).toBe(1)
    })

    it('should merge multiple results', () => {
      const results: SourceScanResult[] = [
        {
          filesScanned: 10,
          linesScanned: 500,
          usedVars: new Map([
            ['API_KEY', [{ file: 'src/api.ts', line: 10, pattern: 'process.env.API_KEY' }]],
          ]),
        },
        {
          filesScanned: 20,
          linesScanned: 1000,
          usedVars: new Map([
            ['DATABASE_URL', [{ file: 'src/db.ts', line: 5, pattern: 'process.env.DATABASE_URL' }]],
          ]),
        },
      ]

      const merged = mergeScanResults(results)

      expect(merged.filesScanned).toBe(30)
      expect(merged.linesScanned).toBe(1500)
      expect(merged.usedVars.size).toBe(2)
      expect(merged.usedVars.has('API_KEY')).toBe(true)
      expect(merged.usedVars.has('DATABASE_URL')).toBe(true)
    })

    it('should combine usages for same variable', () => {
      const results: SourceScanResult[] = [
        {
          filesScanned: 10,
          linesScanned: 500,
          usedVars: new Map([
            ['API_KEY', [{ file: 'src/api.ts', line: 10, pattern: 'process.env.API_KEY' }]],
          ]),
        },
        {
          filesScanned: 20,
          linesScanned: 1000,
          usedVars: new Map([
            ['API_KEY', [{ file: 'src/auth.ts', line: 20, pattern: 'process.env.API_KEY' }]],
          ]),
        },
      ]

      const merged = mergeScanResults(results)

      expect(merged.usedVars.size).toBe(1)
      const apiKeyUsages = merged.usedVars.get('API_KEY')!
      expect(apiKeyUsages).toHaveLength(2)
      expect(apiKeyUsages[0].file).toBe('src/api.ts')
      expect(apiKeyUsages[1].file).toBe('src/auth.ts')
    })
  })

  describe('isIgnoredMissingVar', () => {
    it('should return true for NODE_ENV (built-in)', () => {
      const config: EnvDoctorConfig = {}
      expect(isIgnoredMissingVar('NODE_ENV', config)).toBe(true)
    })

    it('should return true for PLUGIN_VAR (from plugin)', () => {
      const config: EnvDoctorConfig = {}
      expect(isIgnoredMissingVar('PLUGIN_VAR', config)).toBe(true)
    })

    it('should return true for config-specified vars', () => {
      const config: EnvDoctorConfig = {
        scanning: {
          ignoreMissing: ['CUSTOM_VAR'],
        },
      }
      expect(isIgnoredMissingVar('CUSTOM_VAR', config)).toBe(true)
    })

    it('should return false for non-ignored vars', () => {
      const config: EnvDoctorConfig = {}
      expect(isIgnoredMissingVar('MY_API_KEY', config)).toBe(false)
    })
  })

  describe('isIgnoredUnusedVar', () => {
    it('should return true for config-specified vars', () => {
      const config: EnvDoctorConfig = {
        scanning: {
          ignoreUnused: ['INTERNAL_VAR'],
        },
      }
      expect(isIgnoredUnusedVar('INTERNAL_VAR', config)).toBe(true)
    })

    it('should return false for non-ignored vars', () => {
      const config: EnvDoctorConfig = {}
      expect(isIgnoredUnusedVar('MY_VAR', config)).toBe(false)
    })

    it('should return false when ignoreUnused is not configured', () => {
      const config: EnvDoctorConfig = {}
      expect(isIgnoredUnusedVar('ANY_VAR', config)).toBe(false)
    })
  })

  describe('scanAppSources', () => {
    beforeEach(() => {
      vi.resetAllMocks()
    })

    const createApp = (): AppInfo => ({
      name: 'test-app',
      path: '/project/apps/test-app',
      envExamplePath: '/project/apps/test-app/.env.example',
      envLocalPath: '/project/apps/test-app/.env.local',
    })

    it('should find process.env usage in source files', () => {
      const app = createApp()
      const config: EnvDoctorConfig = {}

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        return pathStr === '/project/apps/test-app/src'
      })

      vi.mocked(fs.readdirSync).mockImplementation((p, options) => {
        const pathStr = String(p)
        if (pathStr === '/project/apps/test-app/src') {
          return [
            { name: 'index.ts', isDirectory: () => false, isFile: () => true },
          ] as any
        }
        if (pathStr === '/project/apps/test-app') {
          return [] as any
        }
        return []
      })

      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p).includes('index.ts')) {
          return `
            const apiKey = process.env.API_KEY;
            const dbUrl = process.env.DATABASE_URL;
          `
        }
        return ''
      })

      const result = scanAppSources(app, config)

      expect(result.filesScanned).toBe(1)
      expect(result.usedVars.size).toBe(2)
      expect(result.usedVars.has('API_KEY')).toBe(true)
      expect(result.usedVars.has('DATABASE_URL')).toBe(true)
    })

    it('should find bracket notation process.env usage', () => {
      const app = createApp()
      const config: EnvDoctorConfig = {}

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p).includes('src')) {
          return [{ name: 'config.ts', isDirectory: () => false, isFile: () => true }] as any
        }
        return []
      })
      vi.mocked(fs.readFileSync).mockReturnValue(`
        const key = process.env["SECRET_KEY"];
        const other = process.env['OTHER_KEY'];
      `)

      const result = scanAppSources(app, config)

      expect(result.usedVars.has('SECRET_KEY')).toBe(true)
      expect(result.usedVars.has('OTHER_KEY')).toBe(true)
    })

    it('should find import.meta.env usage (Vite)', () => {
      const app = createApp()
      const config: EnvDoctorConfig = {}

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p).includes('src')) {
          return [{ name: 'app.tsx', isDirectory: () => false, isFile: () => true }] as any
        }
        return []
      })
      vi.mocked(fs.readFileSync).mockReturnValue(`
        const apiUrl = import.meta.env.VITE_API_URL;
      `)

      const result = scanAppSources(app, config)

      expect(result.usedVars.has('VITE_API_URL')).toBe(true)
    })

    it('should skip node_modules and other excluded directories', () => {
      const app = createApp()
      const config: EnvDoctorConfig = {}

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr.includes('src')) {
          return [
            { name: 'index.ts', isDirectory: () => false, isFile: () => true },
            { name: 'node_modules', isDirectory: () => true, isFile: () => false },
            { name: '.git', isDirectory: () => true, isFile: () => false },
          ] as any
        }
        return []
      })
      vi.mocked(fs.readFileSync).mockReturnValue('const x = process.env.TEST_VAR;')

      const result = scanAppSources(app, config)

      // Should only scan index.ts, not descend into node_modules or .git
      expect(result.filesScanned).toBe(1)
    })

    it('should skip env-vars-doctor config files', () => {
      const app = createApp()
      const config: EnvDoctorConfig = {}

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p).includes('src')) {
          return [] as any
        }
        // Root level files
        return [
          { name: 'env-vars-doctor.ts', isDirectory: () => false, isFile: () => true },
          { name: 'app.ts', isDirectory: () => false, isFile: () => true },
        ] as any
      })
      vi.mocked(fs.readFileSync).mockReturnValue('const x = process.env.SHOULD_SKIP;')

      const result = scanAppSources(app, config)

      // Should skip env-vars-doctor.ts but scan app.ts
      expect(result.filesScanned).toBe(1)
    })

    it('should use custom extensions from config', () => {
      const app = createApp()
      const config: EnvDoctorConfig = {
        scanning: {
          extensions: ['.mjs'],
        },
      }

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p).includes('src')) {
          return [
            { name: 'index.ts', isDirectory: () => false, isFile: () => true },
            { name: 'config.mjs', isDirectory: () => false, isFile: () => true },
          ] as any
        }
        return []
      })
      vi.mocked(fs.readFileSync).mockReturnValue('const x = process.env.VAR;')

      const result = scanAppSources(app, config)

      // Should only scan .mjs files based on config
      expect(result.filesScanned).toBe(1)
    })

    it('should handle non-existent src directory', () => {
      const app = createApp()
      const config: EnvDoctorConfig = {}

      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(fs.readdirSync).mockReturnValue([])

      const result = scanAppSources(app, config)

      expect(result.filesScanned).toBe(0)
      expect(result.usedVars.size).toBe(0)
    })

    it('should count lines scanned', () => {
      const app = createApp()
      const config: EnvDoctorConfig = {}

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p).includes('src')) {
          return [{ name: 'file.ts', isDirectory: () => false, isFile: () => true }] as any
        }
        return []
      })
      vi.mocked(fs.readFileSync).mockReturnValue('line1\nline2\nline3\nline4\nline5')

      const result = scanAppSources(app, config)

      expect(result.linesScanned).toBe(5)
    })

    it('should track multiple usages of same variable', () => {
      const app = createApp()
      const config: EnvDoctorConfig = {}

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p).includes('src')) {
          return [{ name: 'file.ts', isDirectory: () => false, isFile: () => true }] as any
        }
        return []
      })
      vi.mocked(fs.readFileSync).mockReturnValue(`
        const a = process.env.API_KEY;
        const b = process.env.API_KEY;
        const c = process.env.API_KEY;
      `)

      const result = scanAppSources(app, config)

      expect(result.usedVars.get('API_KEY')?.length).toBe(3)
    })
  })

  describe('scanPackageSources', () => {
    beforeEach(() => {
      vi.resetAllMocks()
    })

    it('should scan packages directory', () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*', 'packages/*'],
          },
        },
      }

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        return pathStr === '/project/packages' || pathStr === '/project/packages/shared/src'
      })

      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === '/project/packages') {
          return [{ name: 'shared', isDirectory: () => true, isFile: () => false }] as any
        }
        if (pathStr === '/project/packages/shared/src') {
          return [{ name: 'index.ts', isDirectory: () => false, isFile: () => true }] as any
        }
        return []
      })

      vi.mocked(fs.readFileSync).mockReturnValue('const x = process.env.SHARED_VAR;')

      const result = scanPackageSources('/project', config)

      expect(result.usedVars.has('SHARED_VAR')).toBe(true)
    })

    it('should handle no packages directory', () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = scanPackageSources('/project', config)

      expect(result.filesScanned).toBe(0)
    })
  })
})
