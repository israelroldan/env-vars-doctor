import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runCi } from '@/commands/ci.js'
import type { AppInfo, EnvVarDefinition } from '@/core/types.js'

// Mock all dependencies
vi.mock('@/core/scanner.js')
vi.mock('@/core/parser.js')
vi.mock('@/core/config.js')
vi.mock('@/plugins/registry.js')
vi.mock('@/core/reporter.js')

import * as scanner from '@/core/scanner.js'
import * as parser from '@/core/parser.js'
import * as config from '@/core/config.js'
import * as registry from '@/plugins/registry.js'
import * as reporter from '@/core/reporter.js'

// Helpers
function createAppInfo(name: string): AppInfo {
  return {
    name,
    path: `/apps/${name}`,
    envExamplePath: `/apps/${name}/.env.example`,
    envLocalPath: `/apps/${name}/.env.local`,
  }
}

function createVarDef(
  name: string,
  requirement: 'required' | 'optional' = 'required',
  directiveType: string = 'placeholder'
): EnvVarDefinition {
  return {
    name,
    exampleValue: '',
    requirement,
    directive: { type: directiveType as any },
    description: '',
    rawComment: '',
  }
}

function createEnvSchema(variables: EnvVarDefinition[] = [], filePath = '/project/.env.example') {
  return { filePath, variables }
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

describe('ci command', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetAllMocks()
    process.env = { ...originalEnv }
    vi.mocked(config.shouldSkip).mockReturnValue(false)
    vi.mocked(registry.getValueSources).mockReturnValue([])
    vi.mocked(scanner.hasEnvExample).mockReturnValue(true)
    vi.mocked(scanner.getRootEnvPaths).mockReturnValue({
      examplePath: '/project/.env.example',
      localPath: '/project/.env.local',
    })
    vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema())
    vi.mocked(parser.mergeSchemas).mockReturnValue([])
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe('skip behavior', () => {
    it('should skip check when shouldSkip returns true', async () => {
      vi.mocked(config.shouldSkip).mockReturnValue(true)

      const result = await runCi({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printInfo).toHaveBeenCalledWith(
        'Skipping env-vars-doctor check (skip env var is set)'
      )
      expect(result).toBe(0)
    })
  })

  describe('app discovery', () => {
    it('should find specific app when --app is provided', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)

      await runCi({
        app: 'web',
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(scanner.findWorkspace).toHaveBeenCalledWith('web', expect.any(Object), '/project')
    })

    it('should return 1 when app not found', async () => {
      vi.mocked(scanner.findWorkspace).mockResolvedValue(null)

      const result = await runCi({
        app: 'nonexistent',
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printError).toHaveBeenCalledWith('App not found: nonexistent')
      expect(result).toBe(1)
    })

    it('should return 0 when no apps found', async () => {
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
      vi.mocked(scanner.detectCurrentWorkspace).mockResolvedValue(null)

      const result = await runCi({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printInfo).toHaveBeenCalledWith(
        'No apps with .env.local.example files found.'
      )
      expect(result).toBe(0)
    })
  })

  describe('variable checking', () => {
    it('should check variables against process.env', async () => {
      const app = createAppInfo('web')
      const requiredVar = createVarDef('DATABASE_URL', 'required')
      process.env.DATABASE_URL = 'postgres://localhost'

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(parser.mergeSchemas).mockReturnValue([requiredVar])

      const result = await runCi({
        app: 'web',
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printCiPresent).toHaveBeenCalledWith('DATABASE_URL')
      expect(result).toBe(0)
    })

    it('should report missing required variables', async () => {
      const app = createAppInfo('web')
      const requiredVar = createVarDef('MISSING_VAR', 'required')
      delete process.env.MISSING_VAR

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(parser.mergeSchemas).mockReturnValue([requiredVar])

      const result = await runCi({
        app: 'web',
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printCiMissingRequired).toHaveBeenCalledWith('MISSING_VAR')
      expect(result).toBe(1)
    })

    it('should report missing optional variables', async () => {
      const app = createAppInfo('web')
      const optionalVar = createVarDef('OPTIONAL_VAR', 'optional')
      delete process.env.OPTIONAL_VAR

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(parser.mergeSchemas).mockReturnValue([optionalVar])

      const result = await runCi({
        app: 'web',
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printCiMissingOptional).toHaveBeenCalledWith('OPTIONAL_VAR')
      expect(result).toBe(0) // Optional doesn't cause failure
    })

    it('should skip local-only directives', async () => {
      const app = createAppInfo('web')
      const localOnlyVar = createVarDef('LOCAL_VAR', 'required', 'local-only')

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(parser.mergeSchemas).mockReturnValue([localOnlyVar])

      const result = await runCi({
        app: 'web',
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printCiSkipped).toHaveBeenCalledWith(
        'LOCAL_VAR',
        'local-only skipped in CI'
      )
      expect(result).toBe(0)
    })

    it('should skip prompt directives', async () => {
      const app = createAppInfo('web')
      const promptVar = createVarDef('PROMPT_VAR', 'required', 'prompt')

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(parser.mergeSchemas).mockReturnValue([promptVar])

      await runCi({
        app: 'web',
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printCiSkipped).toHaveBeenCalledWith('PROMPT_VAR', 'prompt skipped in CI')
    })

    it('should treat empty string as missing', async () => {
      const app = createAppInfo('web')
      const requiredVar = createVarDef('EMPTY_VAR', 'required')
      process.env.EMPTY_VAR = ''

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(parser.mergeSchemas).mockReturnValue([requiredVar])

      const result = await runCi({
        app: 'web',
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printCiMissingRequired).toHaveBeenCalledWith('EMPTY_VAR')
      expect(result).toBe(1)
    })
  })

  describe('output', () => {
    it('should print CI header', async () => {
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
      vi.mocked(scanner.detectCurrentWorkspace).mockResolvedValue(null)

      await runCi({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printCiHeader).toHaveBeenCalled()
    })

    it('should print CI summary', async () => {
      const app = createAppInfo('web')
      const requiredVar = createVarDef('VAR', 'required')
      process.env.VAR = 'value'

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(parser.mergeSchemas).mockReturnValue([requiredVar])

      await runCi({
        app: 'web',
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printCiSummary).toHaveBeenCalledWith('web', 1, 0, 0)
    })
  })
})
