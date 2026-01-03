import { describe, it, expect } from 'vitest'
import { resolveCopyValue, resolveDefaultValue, resolvePlaceholderValue } from '@/sources/copy.js'
import type { EnvVarDefinition, ResolverContext, EnvDoctorConfig } from '@/core/types.js'

// Helper to create a minimal context
function createContext(currentValues: Map<string, string> = new Map()): ResolverContext {
  return {
    app: {
      name: 'test-app',
      path: '/test',
      envExamplePath: '/test/.env.example',
      envLocalPath: '/test/.env.local',
    },
    currentValues,
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
    directive: { type: 'placeholder' },
    description: 'Test variable',
    rawComment: '',
    ...overrides,
  }
}

describe('copy source', () => {
  describe('resolveCopyValue', () => {
    it('should copy value from existing variable', async () => {
      const context = createContext(new Map([['SOURCE_VAR', 'source_value']]))
      const definition = createDefinition({
        name: 'TARGET_VAR',
        directive: { type: 'copy', copyFrom: 'SOURCE_VAR' },
      })

      const result = await resolveCopyValue(definition, context)

      expect(result.value).toBe('source_value')
      expect(result.source).toBe('copied')
      expect(result.warning).toBeUndefined()
    })

    it('should return example value with warning when source not found', async () => {
      const context = createContext(new Map())
      const definition = createDefinition({
        name: 'TARGET_VAR',
        exampleValue: 'fallback',
        directive: { type: 'copy', copyFrom: 'MISSING_VAR' },
      })

      const result = await resolveCopyValue(definition, context)

      expect(result.value).toBe('fallback')
      expect(result.source).toBe('placeholder')
      expect(result.warning).toContain('MISSING_VAR')
      expect(result.warning).toContain('not found')
    })

    it('should return warning when no copyFrom specified', async () => {
      const context = createContext()
      const definition = createDefinition({
        directive: { type: 'copy' }, // No copyFrom
      })

      const result = await resolveCopyValue(definition, context)

      expect(result.source).toBe('placeholder')
      expect(result.warning).toContain('No source variable specified')
    })

    it('should copy empty string value correctly', async () => {
      const context = createContext(new Map([['SOURCE', '']]))
      const definition = createDefinition({
        directive: { type: 'copy', copyFrom: 'SOURCE' },
      })

      const result = await resolveCopyValue(definition, context)

      expect(result.value).toBe('')
      expect(result.source).toBe('copied')
    })
  })

  describe('resolveDefaultValue', () => {
    it('should return the default value from directive', async () => {
      const context = createContext()
      const definition = createDefinition({
        directive: { type: 'default', defaultValue: 'my_default' },
      })

      const result = await resolveDefaultValue(definition, context)

      expect(result.value).toBe('my_default')
      expect(result.source).toBe('default')
    })

    it('should fall back to example value when no default specified', async () => {
      const context = createContext()
      const definition = createDefinition({
        exampleValue: 'example_fallback',
        directive: { type: 'default' }, // No defaultValue
      })

      const result = await resolveDefaultValue(definition, context)

      expect(result.value).toBe('example_fallback')
      expect(result.source).toBe('default')
    })

    it('should return empty string when no default or example', async () => {
      const context = createContext()
      const definition = createDefinition({
        exampleValue: '',
        directive: { type: 'default' },
      })

      const result = await resolveDefaultValue(definition, context)

      expect(result.value).toBe('')
      expect(result.source).toBe('default')
    })
  })

  describe('resolvePlaceholderValue', () => {
    it('should return example value', async () => {
      const context = createContext()
      const definition = createDefinition({
        exampleValue: 'placeholder_example',
        directive: { type: 'placeholder' },
      })

      const result = await resolvePlaceholderValue(definition, context)

      expect(result.value).toBe('placeholder_example')
      expect(result.source).toBe('placeholder')
    })

    it('should generate REPLACE_ME placeholder when no example', async () => {
      const context = createContext()
      const definition = createDefinition({
        name: 'MY_VAR',
        exampleValue: '',
        directive: { type: 'placeholder' },
      })

      const result = await resolvePlaceholderValue(definition, context)

      expect(result.value).toBe('REPLACE_ME_MY_VAR')
      expect(result.source).toBe('placeholder')
    })

    it('should add warning for required variables', async () => {
      const context = createContext()
      const definition = createDefinition({
        name: 'REQUIRED_VAR',
        requirement: 'required',
        directive: { type: 'placeholder' },
      })

      const result = await resolvePlaceholderValue(definition, context)

      expect(result.warning).toContain('Placeholder used for required variable')
      expect(result.warning).toContain('REQUIRED_VAR')
    })

    it('should not add warning for optional variables', async () => {
      const context = createContext()
      const definition = createDefinition({
        requirement: 'optional',
        directive: { type: 'placeholder' },
      })

      const result = await resolvePlaceholderValue(definition, context)

      expect(result.warning).toBeUndefined()
    })
  })
})
