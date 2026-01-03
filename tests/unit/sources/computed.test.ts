import { describe, it, expect } from 'vitest'
import { resolveComputedValue } from '@/sources/computed.js'
import type { EnvVarDefinition, ResolverContext, EnvDoctorConfig } from '@/core/types.js'

// Helper to create a minimal context
function createContext(): ResolverContext {
  return {
    app: {
      name: 'test-app',
      path: '/test',
      envExamplePath: '/test/.env.example',
      envLocalPath: '/test/.env.local',
    },
    currentValues: new Map(),
    interactive: false,
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
        detection: {},
      },
      plugins: {},
    } as Required<EnvDoctorConfig>,
    rootDir: '/test',
  }
}

// Helper to create a minimal definition
function createDefinition(overrides: Partial<EnvVarDefinition> = {}): EnvVarDefinition {
  return {
    name: 'TEST_VAR',
    exampleValue: 'example',
    requirement: 'required',
    directive: { type: 'computed' },
    description: 'Test variable',
    rawComment: '',
    ...overrides,
  }
}

describe('computed source', () => {
  describe('resolveComputedValue', () => {
    it('should return example value with warning for unsupported compute type', async () => {
      const context = createContext()
      const definition = createDefinition({
        exampleValue: '3000',
        directive: { type: 'computed', computeType: 'port' },
      })

      const result = await resolveComputedValue(definition, context)

      expect(result.value).toBe('3000')
      expect(result.source).toBe('placeholder')
      expect(result.warning).toContain("Computed type 'port' not supported")
      expect(result.warning).toContain('using example value')
    })

    it('should return example value with warning when no compute type specified', async () => {
      const context = createContext()
      const definition = createDefinition({
        exampleValue: 'fallback',
        directive: { type: 'computed' }, // No computeType
      })

      const result = await resolveComputedValue(definition, context)

      expect(result.value).toBe('fallback')
      expect(result.source).toBe('placeholder')
      expect(result.warning).toContain('No compute type specified')
    })

    it('should return empty string when no example value', async () => {
      const context = createContext()
      const definition = createDefinition({
        exampleValue: '',
        directive: { type: 'computed', computeType: 'unknown' },
      })

      const result = await resolveComputedValue(definition, context)

      expect(result.value).toBe('')
      expect(result.source).toBe('placeholder')
    })

    it('should handle various unsupported compute types consistently', async () => {
      const context = createContext()
      const computeTypes = ['port', 'hash', 'uuid', 'random', 'timestamp']

      for (const computeType of computeTypes) {
        const definition = createDefinition({
          exampleValue: 'test_value',
          directive: { type: 'computed', computeType },
        })

        const result = await resolveComputedValue(definition, context)

        expect(result.value).toBe('test_value')
        expect(result.source).toBe('placeholder')
        expect(result.warning).toContain(computeType)
      }
    })
  })
})
