import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as parser from '@/core/parser.js'

// Mock fs module
vi.mock('node:fs')

describe('parser', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('parseEnvExample', () => {
    it('should parse a simple env example file', () => {
      const content = `# Database connection string
DATABASE_URL=postgres://localhost:5432/db

# API Key [required]
API_KEY=your-api-key
`
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(content)

      const result = parser.parseEnvExample('/test/.env.example')

      expect(result.filePath).toBe('/test/.env.example')
      expect(result.variables).toHaveLength(2)
      expect(result.variables[0].name).toBe('DATABASE_URL')
      expect(result.variables[0].description).toBe('Database connection string')
      expect(result.variables[1].name).toBe('API_KEY')
      expect(result.variables[1].requirement).toBe('required')
    })

    it('should return empty variables for non-existent file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = parser.parseEnvExample('/missing/.env.example')

      expect(result.variables).toHaveLength(0)
    })

    it('should parse directive types correctly', () => {
      const content = `# Prompt for value [required] [prompt]
PROMPT_VAR=

# Copy from other [copy:SOURCE_VAR]
COPY_VAR=

# Default value [default:my-default]
DEFAULT_VAR=placeholder

# Boolean toggle [boolean:enabled/disabled]
BOOL_VAR=enabled

# Computed value [computed:port]
COMPUTED_VAR=3000

# Local only [local-only]
LOCAL_VAR=local
`
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(content)

      const result = parser.parseEnvExample('/test/.env.example')

      expect(result.variables).toHaveLength(6)
      expect(result.variables[0].directive.type).toBe('prompt')
      expect(result.variables[1].directive.type).toBe('copy')
      expect(result.variables[1].directive.copyFrom).toBe('SOURCE_VAR')
      expect(result.variables[2].directive.type).toBe('default')
      expect(result.variables[2].directive.defaultValue).toBe('my-default')
      expect(result.variables[3].directive.type).toBe('boolean')
      expect(result.variables[3].directive.booleanYes).toBe('enabled')
      expect(result.variables[3].directive.booleanNo).toBe('disabled')
      expect(result.variables[4].directive.type).toBe('computed')
      expect(result.variables[4].directive.computeType).toBe('port')
      expect(result.variables[5].directive.type).toBe('local-only')
    })

    it('should handle multi-line comments', () => {
      const content = `# This is a long description
# that spans multiple lines
MULTI_LINE_VAR=value
`
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(content)

      const result = parser.parseEnvExample('/test/.env.example')

      expect(result.variables[0].description).toBe('This is a long description that spans multiple lines')
    })

    it('should skip empty lines and reset pending comments', () => {
      const content = `# Comment for first var
FIRST_VAR=1

# This comment should apply to second var
SECOND_VAR=2
`
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(content)

      const result = parser.parseEnvExample('/test/.env.example')

      expect(result.variables).toHaveLength(2)
      expect(result.variables[0].description).toBe('Comment for first var')
      expect(result.variables[1].description).toBe('This comment should apply to second var')
    })

    it('should handle deprecated variables', () => {
      const content = `# Old variable [deprecated]
OLD_VAR=value
`
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(content)

      const result = parser.parseEnvExample('/test/.env.example')

      expect(result.variables[0].requirement).toBe('deprecated')
    })

    it('should handle optional variables', () => {
      const content = `# Optional setting [optional]
OPT_VAR=value
`
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(content)

      const result = parser.parseEnvExample('/test/.env.example')

      expect(result.variables[0].requirement).toBe('optional')
    })
  })

  describe('parseEnvLocal', () => {
    it('should parse existing env.local file', () => {
      const content = `DATABASE_URL=postgres://localhost:5432/mydb
API_KEY=secret123
`
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(content)

      const result = parser.parseEnvLocal('/test/.env.local')

      expect(result.values.get('DATABASE_URL')).toBe('postgres://localhost:5432/mydb')
      expect(result.values.get('API_KEY')).toBe('secret123')
      expect(result.originalContent).toBe(content)
    })

    it('should return empty values for non-existent file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = parser.parseEnvLocal('/missing/.env.local')

      expect(result.values.size).toBe(0)
      expect(result.originalContent).toBe('')
    })

    it('should preserve comments for variables', () => {
      const content = `# Database URL
DATABASE_URL=value
`
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(content)

      const result = parser.parseEnvLocal('/test/.env.local')

      expect(result.comments.get('DATABASE_URL')).toBe('# Database URL')
    })

    it('should handle empty values', () => {
      // Note: parser trims lines before matching, so trailing spaces are removed
      const content = 'EMPTY_VAR=\nNO_VALUE=\n'
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(content)

      const result = parser.parseEnvLocal('/test/.env.local')

      expect(result.values.get('EMPTY_VAR')).toBe('')
      expect(result.values.get('NO_VALUE')).toBe('')
    })

    it('should handle values with quotes and special chars', () => {
      const content = 'QUOTED="hello world"\nURL=https://example.com?foo=bar\n'
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(content)

      const result = parser.parseEnvLocal('/test/.env.local')

      expect(result.values.get('QUOTED')).toBe('"hello world"')
      expect(result.values.get('URL')).toBe('https://example.com?foo=bar')
    })
  })

  describe('mergeSchemas', () => {
    it('should merge two schemas with shared taking base priority', () => {
      const shared = {
        filePath: '/shared/.env.example',
        variables: [
          {
            name: 'SHARED_VAR',
            exampleValue: 'shared_value',
            requirement: 'required' as const,
            directive: { type: 'placeholder' as const },
            description: 'Shared variable',
            rawComment: '',
          },
        ],
      }

      const appSpecific = {
        filePath: '/app/.env.example',
        variables: [
          {
            name: 'APP_VAR',
            exampleValue: 'app_value',
            requirement: 'optional' as const,
            directive: { type: 'prompt' as const },
            description: 'App variable',
            rawComment: '',
          },
        ],
      }

      const result = parser.mergeSchemas(shared, appSpecific)

      expect(result).toHaveLength(2)
      expect(result.find((v) => v.name === 'SHARED_VAR')).toBeDefined()
      expect(result.find((v) => v.name === 'APP_VAR')).toBeDefined()
    })

    it('should allow app-specific to override shared variables', () => {
      const shared = {
        filePath: '/shared/.env.example',
        variables: [
          {
            name: 'DATABASE_URL',
            exampleValue: 'postgres://shared',
            requirement: 'required' as const,
            directive: { type: 'placeholder' as const },
            description: 'Shared DB',
            rawComment: '',
          },
        ],
      }

      const appSpecific = {
        filePath: '/app/.env.example',
        variables: [
          {
            name: 'DATABASE_URL',
            exampleValue: 'postgres://app-specific',
            requirement: 'optional' as const,
            directive: { type: 'prompt' as const },
            description: 'App-specific DB',
            rawComment: '',
          },
        ],
      }

      const result = parser.mergeSchemas(shared, appSpecific)

      expect(result).toHaveLength(1)
      expect(result[0].exampleValue).toBe('postgres://app-specific')
      expect(result[0].description).toBe('App-specific DB')
    })
  })

  describe('formatEnvFile', () => {
    it('should format variables without comments', () => {
      const variables = [
        { name: 'VAR_ONE', value: 'value1' },
        { name: 'VAR_TWO', value: 'value2' },
      ]

      const result = parser.formatEnvFile(variables)

      expect(result).toBe('VAR_ONE=value1\n\nVAR_TWO=value2\n')
    })

    it('should format variables with comments', () => {
      const variables = [
        { name: 'API_KEY', value: 'secret123', comment: '# Your API key' },
        { name: 'DEBUG', value: 'true' },
      ]

      const result = parser.formatEnvFile(variables)

      expect(result).toBe('# Your API key\nAPI_KEY=secret123\n\nDEBUG=true\n')
    })

    it('should handle empty array', () => {
      const result = parser.formatEnvFile([])
      expect(result).toBe('\n')
    })
  })

  describe('updateEnvLocalContent', () => {
    it('should update existing variables in place', () => {
      const original = {
        values: new Map([['EXISTING', 'old_value']]),
        comments: new Map(),
        originalContent: 'EXISTING=old_value\n',
      }

      const updates = new Map([['EXISTING', 'new_value']])
      const schema = [
        {
          name: 'EXISTING',
          exampleValue: '',
          requirement: 'required' as const,
          directive: { type: 'placeholder' as const },
          description: '',
          rawComment: '',
        },
      ]

      const result = parser.updateEnvLocalContent(original, updates, schema)

      expect(result).toContain('EXISTING=new_value')
      expect(result).not.toContain('old_value')
    })

    it('should add new variables at the end', () => {
      const original = {
        values: new Map([['EXISTING', 'value']]),
        comments: new Map(),
        originalContent: 'EXISTING=value\n',
      }

      const updates = new Map([['NEW_VAR', 'new_value']])
      const schema = [
        {
          name: 'NEW_VAR',
          exampleValue: '',
          requirement: 'required' as const,
          directive: { type: 'placeholder' as const },
          description: 'A new variable',
          rawComment: '',
        },
      ]

      const result = parser.updateEnvLocalContent(original, updates, schema)

      expect(result).toContain('EXISTING=value')
      expect(result).toContain('NEW_VAR=new_value')
      expect(result).toContain('# A new variable')
    })

    it('should preserve comments in original content', () => {
      const original = {
        values: new Map([['VAR', 'value']]),
        comments: new Map(),
        originalContent: '# This is a comment\nVAR=value\n',
      }

      const updates = new Map([['VAR', 'updated']])
      const schema: parser.ParseOptions['pluginSources'] = []

      const result = parser.updateEnvLocalContent(original, updates, [])

      expect(result).toContain('# This is a comment')
      expect(result).toContain('VAR=updated')
    })

    it('should preserve non-variable lines that are not comments', () => {
      // Lines that don't match VAR_NAME= pattern (e.g., lowercase, malformed)
      const original = {
        values: new Map([['VALID_VAR', 'value']]),
        comments: new Map(),
        originalContent: 'VALID_VAR=value\nlowercase_var=something\n',
      }

      const updates = new Map([['VALID_VAR', 'updated']])

      const result = parser.updateEnvLocalContent(original, updates, [])

      expect(result).toContain('VALID_VAR=updated')
      expect(result).toContain('lowercase_var=something')
    })

    it('should add separator before new variables when content does not end with blank line', () => {
      const original = {
        values: new Map([['EXISTING', 'value']]),
        comments: new Map(),
        // No trailing newline in original content
        originalContent: 'EXISTING=value',
      }

      const updates = new Map([['NEW_VAR', 'new_value']])
      const schema = [
        {
          name: 'NEW_VAR',
          exampleValue: '',
          requirement: 'required' as const,
          directive: { type: 'placeholder' as const },
          description: 'A new variable',
          rawComment: '',
        },
      ]

      const result = parser.updateEnvLocalContent(original, updates, schema)

      // Should have EXISTING, blank line separator, comment, NEW_VAR
      const lines = result.split('\n')
      const existingIndex = lines.findIndex((l) => l.startsWith('EXISTING'))
      const newVarIndex = lines.findIndex((l) => l.startsWith('NEW_VAR'))

      // There should be a blank line between EXISTING and new content
      expect(existingIndex).toBeLessThan(newVarIndex)
      expect(result).toContain('EXISTING=value')
      expect(result).toContain('NEW_VAR=new_value')
    })

    it('should handle empty original content when adding new variables', () => {
      const original = {
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      }

      const updates = new Map([['NEW_VAR', 'value']])
      const schema = [
        {
          name: 'NEW_VAR',
          exampleValue: '',
          requirement: 'required' as const,
          directive: { type: 'placeholder' as const },
          description: 'Description',
          rawComment: '',
        },
      ]

      const result = parser.updateEnvLocalContent(original, updates, schema)

      expect(result).toContain('NEW_VAR=value')
      expect(result).toContain('# Description')
    })
  })
})
