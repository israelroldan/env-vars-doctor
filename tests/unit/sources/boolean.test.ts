import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as readline from 'node:readline'
import { promptForBoolean } from '@/sources/boolean.js'
import type { EnvVarDefinition, ResolverContext, EnvDoctorConfig } from '@/core/types.js'

// Mock readline module
vi.mock('node:readline')

// Helper to create mock readline interface
function createMockReadline(answers: string[]) {
  let answerIndex = 0
  const mockRl = {
    question: vi.fn((prompt: string, callback: (answer: string) => void) => {
      const answer = answers[answerIndex] ?? ''
      answerIndex++
      setImmediate(() => callback(answer))
    }),
    close: vi.fn(),
  }

  vi.mocked(readline.createInterface).mockReturnValue(mockRl as unknown as readline.Interface)

  return mockRl
}

// Helper to create a minimal context
function createContext(interactive = false): ResolverContext {
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
    name: 'BOOL_VAR',
    exampleValue: 'true',
    requirement: 'required',
    directive: { type: 'boolean' },
    description: 'Boolean variable',
    rawComment: '',
    ...overrides,
  }
}

describe('boolean source', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('promptForBoolean - non-interactive mode', () => {
    it('should return yes value when example is truthy', async () => {
      const context = createContext(false)
      const definition = createDefinition({
        exampleValue: 'true',
        directive: { type: 'boolean', booleanYes: 'true', booleanNo: 'false' },
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('true')
      expect(result.source).toBe('placeholder')
      expect(result.warning).toContain('Non-interactive mode')
    })

    it('should return no value when example is falsy', async () => {
      const context = createContext(false)
      const definition = createDefinition({
        exampleValue: 'false',
        directive: { type: 'boolean', booleanYes: 'true', booleanNo: 'false' },
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('false')
      expect(result.source).toBe('placeholder')
    })

    it('should use custom yes/no values', async () => {
      const context = createContext(false)
      const definition = createDefinition({
        exampleValue: 'enabled',
        directive: { type: 'boolean', booleanYes: 'enabled', booleanNo: 'disabled' },
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('enabled')
    })

    it('should default to no when example does not match yes value', async () => {
      const context = createContext(false)
      const definition = createDefinition({
        exampleValue: 'something-else',
        directive: { type: 'boolean', booleanYes: 'yes', booleanNo: 'no' },
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('no')
    })

    it('should recognize "yes" as truthy example value', async () => {
      const context = createContext(false)
      const definition = createDefinition({
        exampleValue: 'yes',
        directive: { type: 'boolean', booleanYes: 'true', booleanNo: 'false' },
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('true')
    })

    it('should use default yes/no values when not specified', async () => {
      const context = createContext(false)
      const definition = createDefinition({
        exampleValue: 'true',
        directive: { type: 'boolean' }, // No booleanYes/booleanNo
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('true')
    })
  })

  describe('promptForBoolean - interactive mode', () => {
    it('should return yes value when user answers y', async () => {
      const mockRl = createMockReadline(['y'])
      const context = createContext(true)
      const definition = createDefinition({
        directive: { type: 'boolean', booleanYes: 'true', booleanNo: 'false' },
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('true')
      expect(result.source).toBe('prompted')
      expect(mockRl.close).toHaveBeenCalled()
    })

    it('should return no value when user answers n', async () => {
      const mockRl = createMockReadline(['n'])
      const context = createContext(true)
      const definition = createDefinition({
        directive: { type: 'boolean', booleanYes: 'true', booleanNo: 'false' },
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('false')
      expect(result.source).toBe('prompted')
    })

    it('should return yes value for "yes" answer', async () => {
      createMockReadline(['yes'])
      const context = createContext(true)
      const definition = createDefinition({
        directive: { type: 'boolean', booleanYes: 'enabled', booleanNo: 'disabled' },
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('enabled')
    })

    it('should return default (yes) when user presses enter with truthy example', async () => {
      createMockReadline([''])
      const context = createContext(true)
      const definition = createDefinition({
        exampleValue: 'true',
        directive: { type: 'boolean', booleanYes: 'true', booleanNo: 'false' },
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('true')
      expect(result.source).toBe('prompted')
    })

    it('should return default (no) when user presses enter with falsy example', async () => {
      createMockReadline([''])
      const context = createContext(true)
      const definition = createDefinition({
        exampleValue: 'false',
        directive: { type: 'boolean', booleanYes: 'true', booleanNo: 'false' },
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('false')
      expect(result.source).toBe('prompted')
    })

    it('should use custom yes/no values in interactive mode', async () => {
      createMockReadline(['y'])
      const context = createContext(true)
      const definition = createDefinition({
        directive: { type: 'boolean', booleanYes: 'ON', booleanNo: 'OFF' },
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('ON')
    })

    it('should treat non-y answer as no', async () => {
      createMockReadline(['x'])
      const context = createContext(true)
      const definition = createDefinition({
        directive: { type: 'boolean', booleanYes: 'true', booleanNo: 'false' },
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('false')
    })

    it('should use description as hint when available', async () => {
      createMockReadline(['y'])
      const context = createContext(true)
      const definition = createDefinition({
        description: 'Enable feature X',
        directive: { type: 'boolean' },
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('true')
      // Console.log was called with the hint
      expect(console.log).toHaveBeenCalled()
    })

    it('should use variable name as hint when no description', async () => {
      createMockReadline(['y'])
      const context = createContext(true)
      const definition = createDefinition({
        name: 'FEATURE_FLAG',
        description: '',
        directive: { type: 'boolean' },
      })

      const result = await promptForBoolean(definition, context)

      expect(result.value).toBe('true')
    })
  })
})
