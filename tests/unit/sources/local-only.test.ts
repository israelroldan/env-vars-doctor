import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shouldSkipLocalOnly, resolveLocalOnly } from '@/sources/local-only.js'
import type { EnvVarDefinition, ResolverContext, EnvDoctorConfig } from '@/core/types.js'

// Helper to create a minimal context
function createContext(
  interactive = false,
  ciDetection: Record<string, string[]> = {}
): ResolverContext {
  return {
    app: {
      name: 'test-app',
      path: '/test',
      envExamplePath: '/test/.env.example',
      envLocalPath: '/test/.env.local',
    },
    currentValues: new Map(),
    interactive,
    config: {
      version: '1',
      project: {
        rootEnvExample: '.env.local.example',
        rootEnvLocal: '.env.local',
        workspaces: {
          detection: 'auto',
          patterns: [],
          sourceDir: 'src',
        },
      },
      scanning: {
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
        skipDirs: ['node_modules', '.git'],
        ignoreMissing: [],
        ignoreUnused: [],
      },
      ci: {
        skipEnvVar: 'SKIP_ENV_DOCTOR',
        skipDirectives: ['prompt', 'boolean'],
        detection: ciDetection,
      },
      plugins: {},
    } as Required<EnvDoctorConfig>,
    rootDir: '/test',
  }
}

// Helper to create a minimal definition
function createDefinition(overrides: Partial<EnvVarDefinition> = {}): EnvVarDefinition {
  return {
    name: 'LOCAL_VAR',
    exampleValue: 'local-value',
    requirement: 'optional',
    directive: { type: 'local-only' },
    description: 'Local only variable',
    rawComment: '',
    ...overrides,
  }
}

describe('local-only source', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('shouldSkipLocalOnly', () => {
    it('should skip in non-interactive mode', () => {
      const context = createContext(false)

      const result = shouldSkipLocalOnly(context)

      expect(result).toBe(true)
    })

    it('should not skip in interactive mode when not in CI', () => {
      const context = createContext(true)

      const result = shouldSkipLocalOnly(context)

      expect(result).toBe(false)
    })

    it('should skip when CI env var is set', () => {
      process.env.CI = 'true'
      const context = createContext(true, { ci: ['CI'] })

      const result = shouldSkipLocalOnly(context)

      expect(result).toBe(true)
    })

    it('should skip when GITHUB_ACTIONS env var is set', () => {
      process.env.GITHUB_ACTIONS = 'true'
      const context = createContext(true, { github: ['GITHUB_ACTIONS'] })

      const result = shouldSkipLocalOnly(context)

      expect(result).toBe(true)
    })
  })

  describe('resolveLocalOnly', () => {
    it('should skip in non-interactive mode', async () => {
      const context = createContext(false)
      const definition = createDefinition()

      const result = await resolveLocalOnly(definition, context)

      expect(result.value).toBe('')
      expect(result.skipped).toBe(true)
      expect(result.source).toBe('default')
    })

    it('should skip in CI mode', async () => {
      process.env.CI = 'true'
      const context = createContext(true, { ci: ['CI'] })
      const definition = createDefinition()

      const result = await resolveLocalOnly(definition, context)

      expect(result.skipped).toBe(true)
    })

    it('should use default value in interactive local mode', async () => {
      const context = createContext(true)
      const definition = createDefinition({
        directive: { type: 'local-only', defaultValue: 'my-default' },
      })

      const result = await resolveLocalOnly(definition, context)

      expect(result.value).toBe('my-default')
      expect(result.skipped).toBeUndefined()
      expect(result.source).toBe('default')
    })

    it('should fall back to example value when no default', async () => {
      const context = createContext(true)
      const definition = createDefinition({
        exampleValue: 'example-fallback',
        directive: { type: 'local-only' },
      })

      const result = await resolveLocalOnly(definition, context)

      expect(result.value).toBe('example-fallback')
      expect(result.source).toBe('default')
    })

    it('should return empty when no default or example value', async () => {
      const context = createContext(true)
      const definition = createDefinition({
        exampleValue: '',
        directive: { type: 'local-only' },
      })

      const result = await resolveLocalOnly(definition, context)

      expect(result.value).toBe('')
      expect(result.source).toBe('default')
    })
  })
})
