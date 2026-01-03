import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import {
  compareSchemaToActual,
  getAppSchema,
  reconcileApp,
  applyUpdates,
  reconcileAllApps,
} from '@/core/reconciler.js'
import type {
  EnvVarDefinition,
  EnvLocalValues,
  AppInfo,
  EnvDoctorConfig,
  ResolverContext,
} from '@/core/types.js'

// Mock fs module
vi.mock('node:fs')

// Mock scanner module
vi.mock('@/core/scanner.js', () => ({
  getRootEnvPaths: vi.fn(() => ({
    examplePath: '/project/.env.local.example',
    localPath: '/project/.env.local',
  })),
}))

// Mock parser module
vi.mock('@/core/parser.js', () => ({
  parseEnvExample: vi.fn(() => ({ filePath: '/test/.env.example', variables: [] })),
  parseEnvLocal: vi.fn(() => ({
    values: new Map(),
    comments: new Map(),
    originalContent: '',
  })),
  mergeSchemas: vi.fn((root, app) => [...root.variables, ...app.variables]),
  updateEnvLocalContent: vi.fn(() => 'NEW_CONTENT'),
}))

import * as parser from '@/core/parser.js'
import * as scanner from '@/core/scanner.js'

// Helper to create a minimal app info
function createAppInfo(name = 'test-app'): AppInfo {
  return {
    name,
    path: `/apps/${name}`,
    envExamplePath: `/apps/${name}/.env.example`,
    envLocalPath: `/apps/${name}/.env.local`,
  }
}

// Helper to create a variable definition
function createVarDef(
  name: string,
  overrides: Partial<EnvVarDefinition> = {}
): EnvVarDefinition {
  return {
    name,
    exampleValue: 'example',
    requirement: 'required',
    directive: { type: 'placeholder' },
    description: `${name} description`,
    rawComment: '',
    ...overrides,
  }
}

// Helper to create env local values
function createEnvLocal(
  values: Record<string, string>,
  originalContent = ''
): EnvLocalValues {
  return {
    values: new Map(Object.entries(values)),
    comments: new Map(),
    originalContent,
  }
}

// Helper to create an EnvSchema
function createEnvSchema(variables: EnvVarDefinition[] = [], filePath = '/test/.env.example') {
  return { filePath, variables }
}

// Helper to create a minimal config
function createConfig(): Required<EnvDoctorConfig> {
  return {
    version: '1',
    project: {
      rootEnvExample: '.env.local.example',
      rootEnvLocal: '.env.local',
      workspaces: {
        detection: 'auto',
        patterns: ['apps/*'],
        sourceDir: 'src',
      },
    },
    scanning: {
      extensions: ['.ts', '.tsx'],
      skipDirs: ['node_modules'],
      ignoreMissing: [],
      ignoreUnused: [],
    },
    ci: {
      skipEnvVar: 'SKIP_ENV_DOCTOR',
      skipDirectives: ['prompt'],
      detection: {},
    },
    plugins: {},
  }
}

describe('reconciler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('compareSchemaToActual', () => {
    it('should identify valid variables', () => {
      const schema = [createVarDef('DATABASE_URL'), createVarDef('API_KEY')]
      const actual = createEnvLocal({
        DATABASE_URL: 'postgres://localhost',
        API_KEY: 'secret123',
      })
      const app = createAppInfo()

      const result = compareSchemaToActual(schema, actual, app)

      expect(result.valid).toHaveLength(2)
      expect(result.missing).toHaveLength(0)
      expect(result.extra).toHaveLength(0)
    })

    it('should identify missing variables', () => {
      const schema = [
        createVarDef('DATABASE_URL'),
        createVarDef('API_KEY'),
        createVarDef('SECRET'),
      ]
      const actual = createEnvLocal({
        DATABASE_URL: 'postgres://localhost',
      })
      const app = createAppInfo()

      const result = compareSchemaToActual(schema, actual, app)

      expect(result.valid).toHaveLength(1)
      expect(result.missing).toHaveLength(2)
      expect(result.missing.map((v) => v.name)).toContain('API_KEY')
      expect(result.missing.map((v) => v.name)).toContain('SECRET')
    })

    it('should identify extra variables not in schema', () => {
      const schema = [createVarDef('DATABASE_URL')]
      const actual = createEnvLocal({
        DATABASE_URL: 'postgres://localhost',
        UNKNOWN_VAR: 'mystery',
        ANOTHER_UNKNOWN: 'value',
      })
      const app = createAppInfo()

      const result = compareSchemaToActual(schema, actual, app)

      expect(result.extra).toHaveLength(2)
      expect(result.extra).toContain('UNKNOWN_VAR')
      expect(result.extra).toContain('ANOTHER_UNKNOWN')
    })

    it('should identify deprecated variables that still exist', () => {
      const schema = [
        createVarDef('ACTIVE_VAR'),
        createVarDef('OLD_VAR', { requirement: 'deprecated' }),
      ]
      const actual = createEnvLocal({
        ACTIVE_VAR: 'active',
        OLD_VAR: 'still-here',
      })
      const app = createAppInfo()

      const result = compareSchemaToActual(schema, actual, app)

      expect(result.valid).toHaveLength(1)
      expect(result.deprecated).toHaveLength(1)
      expect(result.deprecated).toContain('OLD_VAR')
    })

    it('should not flag deprecated variables if they are removed', () => {
      const schema = [createVarDef('OLD_VAR', { requirement: 'deprecated' })]
      const actual = createEnvLocal({})
      const app = createAppInfo()

      const result = compareSchemaToActual(schema, actual, app)

      expect(result.deprecated).toHaveLength(0)
      expect(result.missing).toHaveLength(0) // Deprecated vars shouldn't be in missing
    })

    it('should treat empty string values as missing', () => {
      const schema = [createVarDef('EMPTY_VAR')]
      const actual = createEnvLocal({
        EMPTY_VAR: '',
      })
      const app = createAppInfo()

      const result = compareSchemaToActual(schema, actual, app)

      expect(result.missing).toHaveLength(1)
      expect(result.valid).toHaveLength(0)
    })

    it('should detect overrides when shared values differ', () => {
      const schema = [createVarDef('DATABASE_URL'), createVarDef('API_KEY')]
      const actual = createEnvLocal({
        DATABASE_URL: 'postgres://app-specific-db',
        API_KEY: 'shared-key',
      })
      const app = createAppInfo()

      const sharedValues = new Map([
        ['DATABASE_URL', 'postgres://shared-db'],
        ['API_KEY', 'shared-key'],
      ])
      const sharedVarNames = new Set(['DATABASE_URL', 'API_KEY'])

      const result = compareSchemaToActual(schema, actual, app, sharedValues, sharedVarNames)

      expect(result.overrides.size).toBe(1)
      expect(result.overrides.get('DATABASE_URL')).toBe('postgres://app-specific-db')
      // API_KEY has same value, so no override
      expect(result.overrides.has('API_KEY')).toBe(false)
    })

    it('should handle empty schema', () => {
      const schema: EnvVarDefinition[] = []
      const actual = createEnvLocal({
        ORPHAN_VAR: 'value',
      })
      const app = createAppInfo()

      const result = compareSchemaToActual(schema, actual, app)

      expect(result.valid).toHaveLength(0)
      expect(result.missing).toHaveLength(0)
      expect(result.extra).toHaveLength(1)
    })

    it('should handle empty actual values', () => {
      const schema = [createVarDef('VAR1'), createVarDef('VAR2')]
      const actual = createEnvLocal({})
      const app = createAppInfo()

      const result = compareSchemaToActual(schema, actual, app)

      expect(result.missing).toHaveLength(2)
      expect(result.valid).toHaveLength(0)
      expect(result.extra).toHaveLength(0)
    })

    it('should include app in result', () => {
      const schema = [createVarDef('VAR')]
      const actual = createEnvLocal({ VAR: 'value' })
      const app = createAppInfo('my-app')

      const result = compareSchemaToActual(schema, actual, app)

      expect(result.app.name).toBe('my-app')
    })
  })

  describe('getAppSchema', () => {
    it('should merge root and app schemas', () => {
      const rootVar = createVarDef('ROOT_VAR')
      const appVar = createVarDef('APP_VAR')

      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce(createEnvSchema([rootVar])) // Root schema
        .mockReturnValueOnce(createEnvSchema([appVar])) // App schema

      vi.mocked(parser.mergeSchemas).mockReturnValue([rootVar, appVar])

      const app = createAppInfo()
      const options = { rootDir: '/project', config: createConfig() }

      const result = getAppSchema(app, options)

      expect(parser.parseEnvExample).toHaveBeenCalledTimes(2)
      expect(parser.mergeSchemas).toHaveBeenCalledWith(
        createEnvSchema([rootVar]),
        createEnvSchema([appVar])
      )
      expect(result).toEqual([rootVar, appVar])
    })

    it('should pass plugin sources to parseEnvExample', () => {
      const pluginSource = {
        directiveType: 'test-plugin',
        pattern: /test/,
        resolve: vi.fn(),
      }

      const app = createAppInfo()
      const options = {
        rootDir: '/project',
        config: createConfig(),
        pluginSources: [pluginSource],
      }

      getAppSchema(app, options)

      expect(parser.parseEnvExample).toHaveBeenCalledWith(expect.any(String), {
        pluginSources: [pluginSource],
      })
    })
  })

  describe('reconcileApp', () => {
    it('should return empty updates when no missing variables', async () => {
      vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema([]))
      vi.mocked(parser.mergeSchemas).mockReturnValue([])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })

      const app = createAppInfo()
      const resolveValue = vi.fn()
      const options = {
        interactive: false,
        rootDir: '/project',
        config: createConfig(),
        resolveValue,
      }

      const { result, updates, warnings } = await reconcileApp(app, options)

      expect(updates.size).toBe(0)
      expect(warnings).toHaveLength(0)
      expect(resolveValue).not.toHaveBeenCalled()
    })

    it('should resolve missing variables', async () => {
      const missingVar = createVarDef('MISSING_VAR')

      vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema([missingVar]))
      vi.mocked(parser.mergeSchemas).mockReturnValue([missingVar])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })

      const app = createAppInfo()
      const resolveValue = vi.fn().mockResolvedValue({
        value: 'resolved-value',
        skipped: false,
      })
      const options = {
        interactive: true,
        rootDir: '/project',
        config: createConfig(),
        resolveValue,
      }

      const { result, updates, warnings } = await reconcileApp(app, options)

      expect(resolveValue).toHaveBeenCalledWith(
        missingVar,
        expect.objectContaining({
          app,
          interactive: true,
        })
      )
      expect(updates.get('MISSING_VAR')).toBe('resolved-value')
    })

    it('should skip variables when resolver indicates skipped', async () => {
      const missingVar = createVarDef('MISSING_VAR')

      vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema([missingVar]))
      vi.mocked(parser.mergeSchemas).mockReturnValue([missingVar])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })

      const resolveValue = vi.fn().mockResolvedValue({
        value: '',
        skipped: true,
      })

      const { updates } = await reconcileApp(createAppInfo(), {
        interactive: true,
        rootDir: '/project',
        config: createConfig(),
        resolveValue,
      })

      expect(updates.size).toBe(0)
    })

    it('should collect warnings from resolver', async () => {
      const missingVar = createVarDef('MISSING_VAR')

      vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema([missingVar]))
      vi.mocked(parser.mergeSchemas).mockReturnValue([missingVar])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })

      const resolveValue = vi.fn().mockResolvedValue({
        value: 'value',
        skipped: false,
        warning: 'This is a warning',
      })

      const { warnings } = await reconcileApp(createAppInfo(), {
        interactive: false,
        rootDir: '/project',
        config: createConfig(),
        resolveValue,
      })

      expect(warnings).toContain('This is a warning')
    })

    it('should detect overrides when shared values differ', async () => {
      const sharedVar = createVarDef('SHARED_VAR')

      vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema([sharedVar]))
      vi.mocked(parser.mergeSchemas).mockReturnValue([sharedVar])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['SHARED_VAR', 'app-value']]),
        comments: new Map(),
        originalContent: '',
      })

      const sharedValues = new Map([['SHARED_VAR', 'root-value']])
      const sharedVarNames = new Set(['SHARED_VAR'])

      const { result } = await reconcileApp(createAppInfo(), {
        interactive: false,
        rootDir: '/project',
        config: createConfig(),
        resolveValue: vi.fn(),
        sharedValues,
        sharedVarNames,
      })

      expect(result.overrides.get('SHARED_VAR')).toBe('app-value')
    })
  })

  describe('applyUpdates', () => {
    it('should not write file when no updates', () => {
      const app = createAppInfo()
      const updates = new Map<string, string>()
      const options = { rootDir: '/project', config: createConfig() }

      applyUpdates(app, updates, options)

      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })

    it('should write updated content to file', () => {
      const app = createAppInfo()
      const updates = new Map([['NEW_VAR', 'new-value']])
      const options = { rootDir: '/project', config: createConfig() }

      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(parser.updateEnvLocalContent).mockReturnValue('UPDATED_CONTENT')

      applyUpdates(app, updates, options)

      expect(parser.updateEnvLocalContent).toHaveBeenCalled()
      expect(fs.writeFileSync).toHaveBeenCalledWith(app.envLocalPath, 'UPDATED_CONTENT')
    })
  })

  describe('reconcileAllApps', () => {
    it('should process all apps and return combined results', async () => {
      const app1 = createAppInfo('app1')
      const app2 = createAppInfo('app2')

      vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema([]))
      vi.mocked(parser.mergeSchemas).mockReturnValue([])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })

      const resolveValue = vi.fn()
      const options = {
        interactive: false,
        rootDir: '/project',
        config: createConfig(),
        resolveValue,
      }

      const { results, totalUpdates, warnings } = await reconcileAllApps([app1, app2], options)

      expect(results).toHaveLength(2)
      expect(results[0].app.name).toBe('app1')
      expect(results[1].app.name).toBe('app2')
      expect(totalUpdates).toBe(0)
    })

    it('should apply updates when not in dry run mode', async () => {
      const app = createAppInfo()
      const missingVar = createVarDef('MISSING_VAR')

      vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema([missingVar]))
      vi.mocked(parser.mergeSchemas).mockReturnValue([missingVar])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(parser.updateEnvLocalContent).mockReturnValue('NEW_CONTENT')

      const resolveValue = vi.fn().mockResolvedValue({
        value: 'resolved',
        skipped: false,
      })

      const { totalUpdates } = await reconcileAllApps([app], {
        interactive: false,
        dryRun: false,
        rootDir: '/project',
        config: createConfig(),
        resolveValue,
      })

      expect(totalUpdates).toBe(1)
      expect(fs.writeFileSync).toHaveBeenCalled()
    })

    it('should not apply updates in dry run mode', async () => {
      const app = createAppInfo()
      const missingVar = createVarDef('MISSING_VAR')

      vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema([missingVar]))
      vi.mocked(parser.mergeSchemas).mockReturnValue([missingVar])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })

      const resolveValue = vi.fn().mockResolvedValue({
        value: 'resolved',
        skipped: false,
      })

      const { totalUpdates } = await reconcileAllApps([app], {
        interactive: false,
        dryRun: true,
        rootDir: '/project',
        config: createConfig(),
        resolveValue,
      })

      expect(totalUpdates).toBe(0)
      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })

    it('should collect warnings from all apps', async () => {
      const app1 = createAppInfo('app1')
      const app2 = createAppInfo('app2')
      const missingVar = createVarDef('MISSING_VAR')

      vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema([missingVar]))
      vi.mocked(parser.mergeSchemas).mockReturnValue([missingVar])
      // Use mockImplementation to return a fresh Map for each call
      // (mockReturnValue would share the same Map instance, causing
      // the second app to see values set by the first app)
      vi.mocked(parser.parseEnvLocal).mockImplementation(() => ({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      }))

      const resolveValue = vi.fn().mockResolvedValue({
        value: 'value',
        warning: 'Warning for app',
      })

      const { warnings } = await reconcileAllApps([app1, app2], {
        interactive: false,
        dryRun: true,
        rootDir: '/project',
        config: createConfig(),
        resolveValue,
      })

      expect(warnings).toHaveLength(2)
    })
  })
})
