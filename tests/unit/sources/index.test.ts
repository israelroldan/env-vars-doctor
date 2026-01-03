import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  resolveValue,
  registerPluginSources,
  getPluginSources,
  clearPluginSources,
  createValueResolver,
} from '@/sources/index.js'
import type { EnvVarDefinition, ResolverContext, EnvDoctorConfig, ValueSourceProvider } from '@/core/types.js'

// Helper to create a minimal context
function createContext(
  currentValues: Map<string, string> = new Map(),
  interactive = false
): ResolverContext {
  return {
    app: {
      name: 'test-app',
      path: '/test',
      envExamplePath: '/test/.env.example',
      envLocalPath: '/test/.env.local',
    },
    currentValues,
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

describe('sources/index', () => {
  beforeEach(() => {
    clearPluginSources()
  })

  afterEach(() => {
    clearPluginSources()
  })

  describe('plugin source registration', () => {
    it('should start with no plugin sources', () => {
      expect(getPluginSources()).toHaveLength(0)
    })

    it('should register plugin sources', () => {
      const sources: ValueSourceProvider[] = [
        {
          directiveType: 'custom',
          pattern: /\[custom\]/,
          resolve: async () => ({ value: 'custom-value', source: 'custom' }),
        },
      ]

      registerPluginSources(sources)

      expect(getPluginSources()).toHaveLength(1)
      expect(getPluginSources()[0].directiveType).toBe('custom')
    })

    it('should clear plugin sources', () => {
      registerPluginSources([
        {
          directiveType: 'test',
          pattern: /\[test\]/,
          resolve: async () => ({ value: 'test', source: 'test' }),
        },
      ])

      clearPluginSources()

      expect(getPluginSources()).toHaveLength(0)
    })

    it('should replace existing sources on register', () => {
      registerPluginSources([
        {
          directiveType: 'first',
          pattern: /\[first\]/,
          resolve: async () => ({ value: 'first', source: 'first' }),
        },
      ])

      registerPluginSources([
        {
          directiveType: 'second',
          pattern: /\[second\]/,
          resolve: async () => ({ value: 'second', source: 'second' }),
        },
      ])

      expect(getPluginSources()).toHaveLength(1)
      expect(getPluginSources()[0].directiveType).toBe('second')
    })
  })

  describe('resolveValue', () => {
    it('should return existing value if already set', async () => {
      const context = createContext(new Map([['TEST_VAR', 'existing-value']]))
      const definition = createDefinition()

      const result = await resolveValue(definition, context)

      expect(result.value).toBe('existing-value')
      expect(result.source).toBe('existing')
    })

    it('should not return existing value if empty', async () => {
      const context = createContext(new Map([['TEST_VAR', '']]))
      const definition = createDefinition({
        exampleValue: 'fallback',
        directive: { type: 'placeholder' },
      })

      const result = await resolveValue(definition, context)

      expect(result.value).toBe('fallback')
      expect(result.source).toBe('placeholder')
    })

    it('should resolve placeholder directive', async () => {
      const context = createContext()
      const definition = createDefinition({
        exampleValue: 'placeholder-value',
        directive: { type: 'placeholder' },
      })

      const result = await resolveValue(definition, context)

      expect(result.value).toBe('placeholder-value')
      expect(result.source).toBe('placeholder')
    })

    it('should resolve default directive', async () => {
      const context = createContext()
      const definition = createDefinition({
        directive: { type: 'default', defaultValue: 'my-default' },
      })

      const result = await resolveValue(definition, context)

      expect(result.value).toBe('my-default')
      expect(result.source).toBe('default')
    })

    it('should resolve copy directive', async () => {
      const context = createContext(new Map([['SOURCE_VAR', 'copied-value']]))
      const definition = createDefinition({
        directive: { type: 'copy', copyFrom: 'SOURCE_VAR' },
      })

      const result = await resolveValue(definition, context)

      expect(result.value).toBe('copied-value')
      expect(result.source).toBe('copied')
    })

    it('should resolve computed directive', async () => {
      const context = createContext()
      const definition = createDefinition({
        exampleValue: '3000',
        directive: { type: 'computed', computeType: 'port' },
      })

      const result = await resolveValue(definition, context)

      expect(result.value).toBe('3000')
      expect(result.source).toBe('placeholder')
    })

    it('should resolve local-only directive (non-interactive)', async () => {
      const context = createContext(new Map(), false)
      const definition = createDefinition({
        directive: { type: 'local-only' },
      })

      const result = await resolveValue(definition, context)

      expect(result.skipped).toBe(true)
    })

    it('should resolve boolean directive (non-interactive)', async () => {
      const context = createContext(new Map(), false)
      const definition = createDefinition({
        exampleValue: 'true',
        directive: { type: 'boolean', booleanYes: 'true', booleanNo: 'false' },
      })

      const result = await resolveValue(definition, context)

      expect(result.value).toBe('true')
      expect(result.source).toBe('placeholder')
    })

    it('should use plugin source for custom directive', async () => {
      registerPluginSources([
        {
          directiveType: 'custom-plugin',
          pattern: /\[custom-plugin\]/,
          resolve: async () => ({ value: 'plugin-resolved', source: 'custom-plugin' }),
        },
      ])

      const context = createContext()
      const definition = createDefinition({
        directive: { type: 'custom-plugin' },
      })

      const result = await resolveValue(definition, context)

      expect(result.value).toBe('plugin-resolved')
      expect(result.source).toBe('custom-plugin')
    })

    it('should check plugin availability before resolving', async () => {
      registerPluginSources([
        {
          directiveType: 'unavailable-plugin',
          pattern: /\[unavailable-plugin\]/,
          resolve: async () => ({ value: 'should-not-reach', source: 'plugin' }),
          isAvailable: () => false,
          unavailableMessage: 'Plugin not available',
        },
      ])

      const context = createContext()
      const definition = createDefinition({
        exampleValue: 'fallback',
        directive: { type: 'unavailable-plugin' },
      })

      const result = await resolveValue(definition, context)

      expect(result.value).toBe('fallback')
      expect(result.source).toBe('placeholder')
      expect(result.warning).toBe('Plugin not available')
    })

    it('should fall back to placeholder for unknown directive type', async () => {
      const context = createContext()
      const definition = createDefinition({
        exampleValue: 'fallback',
        directive: { type: 'unknown-type' as any },
      })

      const result = await resolveValue(definition, context)

      expect(result.value).toBe('fallback')
      expect(result.source).toBe('placeholder')
    })
  })

  describe('createValueResolver', () => {
    it('should create a resolver function', async () => {
      const resolver = createValueResolver()
      const context = createContext()
      const definition = createDefinition({ exampleValue: 'test-value' })

      const result = await resolver(definition, context)

      expect(result.value).toBe('test-value')
    })

    it('should support custom sources', async () => {
      const customSources: ValueSourceProvider[] = [
        {
          directiveType: 'temp-custom',
          pattern: /\[temp-custom\]/,
          resolve: async () => ({ value: 'temp-custom-value', source: 'temp-custom' }),
        },
      ]

      const resolver = createValueResolver(customSources)
      const context = createContext()
      const definition = createDefinition({
        directive: { type: 'temp-custom' },
      })

      const result = await resolver(definition, context)

      expect(result.value).toBe('temp-custom-value')
      expect(result.source).toBe('temp-custom')
    })

    it('should not permanently register custom sources', async () => {
      const customSources: ValueSourceProvider[] = [
        {
          directiveType: 'temp-source',
          pattern: /\[temp-source\]/,
          resolve: async () => ({ value: 'temp', source: 'temp' }),
        },
      ]

      const resolver = createValueResolver(customSources)
      const context = createContext()
      const definition = createDefinition({ directive: { type: 'temp-source' } })

      await resolver(definition, context)

      // After resolver call, plugin sources should be empty
      expect(getPluginSources()).toHaveLength(0)
    })
  })
})
