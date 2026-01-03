import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runPostinstall } from '@/commands/postinstall.js'
import type { AppInfo, EnvVarDefinition } from '@/core/types.js'

// Mock dependencies
vi.mock('@/core/config.js')
vi.mock('@/core/scanner.js')
vi.mock('@/core/parser.js')
vi.mock('@/commands/ci.js')

import * as config from '@/core/config.js'
import * as scanner from '@/core/scanner.js'
import * as parser from '@/core/parser.js'
import { runCi } from '@/commands/ci.js'

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
  requirement: 'required' | 'optional' = 'required'
): EnvVarDefinition {
  return {
    name,
    exampleValue: '',
    requirement,
    directive: { type: 'placeholder' },
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

describe('postinstall command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(config.isCI).mockReturnValue(false)
    vi.mocked(scanner.hasEnvExample).mockReturnValue(true)
    vi.mocked(scanner.getRootEnvPaths).mockReturnValue({
      examplePath: '/project/.env.example',
      localPath: '/project/.env.local',
    })
    vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
    vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema())
    vi.mocked(parser.parseEnvLocal).mockReturnValue({
      values: new Map(),
      comments: new Map(),
      originalContent: '',
    })
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    vi.restoreAllMocks()
  })

  describe('CI mode', () => {
    it('should delegate to runCi in CI environment', async () => {
      vi.mocked(config.isCI).mockReturnValue(true)
      vi.mocked(runCi).mockResolvedValue(0)

      const options = {
        rootDir: '/project',
        config: createDefaultConfig(),
      }

      await runPostinstall(options)

      expect(runCi).toHaveBeenCalledWith(options)
    })

    it('should return runCi result', async () => {
      vi.mocked(config.isCI).mockReturnValue(true)
      vi.mocked(runCi).mockResolvedValue(1)

      const result = await runPostinstall({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(result).toBe(1)
    })
  })

  describe('local mode', () => {
    it('should always return 0 locally', async () => {
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([createAppInfo('web')])
      vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema([createVarDef('MISSING', 'required')]))
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })

      const result = await runPostinstall({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      // Never fails locally
      expect(result).toBe(0)
    })

    it('should print box when all ready', async () => {
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([createAppInfo('web')])
      vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema([createVarDef('VAR1')]))
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['VAR1', 'value']]),
        comments: new Map(),
        originalContent: '',
      })

      await runPostinstall({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('Environment ready')
    })

    it('should report missing required variables', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema([createVarDef('MISSING', 'required')]))
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })

      await runPostinstall({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('required')
      expect(output).toContain('missing')
    })

    it('should report missing optional variables', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema([createVarDef('OPT', 'optional')]))
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })

      await runPostinstall({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('optional')
      expect(output).toContain('missing')
    })

    it('should count unique missing variables', async () => {
      const apps = [createAppInfo('web'), createAppInfo('api')]
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue(apps)
      vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema([createVarDef('SHARED', 'required')]))
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })

      await runPostinstall({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      // SHARED is missing from both apps but should only be counted once
      expect(output).toContain('1 required variable')
    })

    it('should check app-specific schemas', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce(createEnvSchema()) // root schema
        .mockReturnValueOnce(createEnvSchema([createVarDef('APP_VAR')])) // app schema

      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })

      await runPostinstall({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('missing')
    })

    it('should treat empty string as missing', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample).mockReturnValue(
        createEnvSchema([createVarDef('VAR1', 'required')])
      )
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['VAR1', '']]),
        comments: new Map(),
        originalContent: '',
      })

      await runPostinstall({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('required')
      expect(output).toContain('missing')
    })
  })
})
