import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as readline from 'node:readline'
import { promptForValue, confirm, select } from '@/sources/prompt.js'
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
      // Simulate async behavior
      setImmediate(() => callback(answer))
    }),
    close: vi.fn(),
  }

  vi.mocked(readline.createInterface).mockReturnValue(mockRl as unknown as readline.Interface)

  return mockRl
}

// Helper to create a minimal context
function createContext(interactive = true): ResolverContext {
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
    name: 'TEST_VAR',
    exampleValue: 'example',
    requirement: 'required',
    directive: { type: 'prompt' },
    description: 'Test variable',
    rawComment: '',
    ...overrides,
  }
}

describe('prompt source', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Suppress console.log during tests
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('promptForValue', () => {
    describe('non-interactive mode', () => {
      it('should return placeholder with example value', async () => {
        const context = createContext(false)
        const definition = createDefinition({ exampleValue: 'my-example' })

        const result = await promptForValue(definition, context)

        expect(result.value).toBe('my-example')
        expect(result.source).toBe('placeholder')
        expect(result.warning).toContain('Non-interactive mode')
      })

      it('should return REPLACE_ME placeholder when no example', async () => {
        const context = createContext(false)
        const definition = createDefinition({ exampleValue: '' })

        const result = await promptForValue(definition, context)

        expect(result.value).toBe('REPLACE_ME_TEST_VAR')
        expect(result.source).toBe('placeholder')
      })
    })

    describe('interactive mode', () => {
      it('should return user input', async () => {
        const mockRl = createMockReadline(['user-input-value'])
        const context = createContext(true)
        const definition = createDefinition()

        const result = await promptForValue(definition, context)

        expect(result.value).toBe('user-input-value')
        expect(result.source).toBe('prompted')
        expect(mockRl.close).toHaveBeenCalled()
      })

      it('should use example value when user presses enter', async () => {
        const mockRl = createMockReadline([''])
        const context = createContext(true)
        const definition = createDefinition({ exampleValue: 'default-value' })

        const result = await promptForValue(definition, context)

        expect(result.value).toBe('default-value')
        expect(result.source).toBe('prompted')
      })

      it('should skip optional variable with no input and no example', async () => {
        const mockRl = createMockReadline([''])
        const context = createContext(true)
        const definition = createDefinition({
          exampleValue: '',
          requirement: 'optional',
        })

        const result = await promptForValue(definition, context)

        expect(result.value).toBe('')
        expect(result.skipped).toBe(true)
      })

      it('should ask to skip required variable with no input', async () => {
        // First answer empty, second answer 'y' to skip
        const mockRl = createMockReadline(['', 'y'])
        const context = createContext(true)
        const definition = createDefinition({
          exampleValue: '',
          requirement: 'required',
        })

        const result = await promptForValue(definition, context)

        expect(result.value).toBe('')
        expect(result.skipped).toBe(true)
        expect(result.warning).toContain('Skipped required variable')
      })

      it('should trim whitespace from input', async () => {
        const mockRl = createMockReadline(['  trimmed-value  '])
        const context = createContext(true)
        const definition = createDefinition()

        const result = await promptForValue(definition, context)

        expect(result.value).toBe('trimmed-value')
      })
    })
  })

  describe('confirm', () => {
    it('should return true for "y" answer', async () => {
      const mockRl = createMockReadline(['y'])

      const result = await confirm('Continue?')

      expect(result).toBe(true)
      expect(mockRl.close).toHaveBeenCalled()
    })

    it('should return true for "yes" answer', async () => {
      createMockReadline(['yes'])

      const result = await confirm('Continue?')

      expect(result).toBe(true)
    })

    it('should return false for "n" answer', async () => {
      createMockReadline(['n'])

      const result = await confirm('Continue?')

      expect(result).toBe(false)
    })

    it('should return default value (true) for empty answer', async () => {
      createMockReadline([''])

      const result = await confirm('Continue?', true)

      expect(result).toBe(true)
    })

    it('should return default value (false) for empty answer', async () => {
      createMockReadline([''])

      const result = await confirm('Continue?', false)

      expect(result).toBe(false)
    })

    it('should return false for any non-y answer', async () => {
      createMockReadline(['x'])

      const result = await confirm('Continue?')

      expect(result).toBe(false)
    })
  })

  describe('select', () => {
    it('should return selected option by number', async () => {
      createMockReadline(['2'])

      const result = await select('Choose:', ['Option A', 'Option B', 'Option C'])

      expect(result).toBe('Option B')
    })

    it('should return first option for invalid input', async () => {
      createMockReadline(['invalid'])

      const result = await select('Choose:', ['First', 'Second'])

      expect(result).toBe('First')
    })

    it('should return first option for out-of-range number', async () => {
      createMockReadline(['99'])

      const result = await select('Choose:', ['A', 'B'])

      expect(result).toBe('A')
    })

    it('should return first option for zero', async () => {
      createMockReadline(['0'])

      const result = await select('Choose:', ['A', 'B'])

      expect(result).toBe('A')
    })

    it('should return first option for negative number', async () => {
      createMockReadline(['-1'])

      const result = await select('Choose:', ['A', 'B'])

      expect(result).toBe('A')
    })

    it('should throw for empty options', async () => {
      await expect(select('Choose:', [])).rejects.toThrow('at least one option')
    })

    it('should handle single option', async () => {
      createMockReadline(['1'])

      const result = await select('Choose:', ['Only Option'])

      expect(result).toBe('Only Option')
    })
  })
})
