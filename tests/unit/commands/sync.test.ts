import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import { runSync } from '@/commands/sync.js'
import type { AppInfo, EnvVarDefinition, ReconciliationResult } from '@/core/types.js'

// Mock all dependencies
vi.mock('node:fs')
vi.mock('@/core/scanner.js')
vi.mock('@/core/parser.js')
vi.mock('@/core/reconciler.js')
vi.mock('@/sources/index.js')
vi.mock('@/plugins/registry.js')
vi.mock('@/core/reporter.js')

import * as scanner from '@/core/scanner.js'
import * as parser from '@/core/parser.js'
import * as reconciler from '@/core/reconciler.js'
import * as sources from '@/sources/index.js'
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

function createReconciliationResult(
  app: AppInfo,
  overrides: Partial<ReconciliationResult> = {}
): ReconciliationResult {
  return {
    app,
    valid: [],
    missing: [],
    extra: [],
    deprecated: [],
    overrides: new Map(),
    ...overrides,
  }
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

describe('sync command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(registry.getValueSources).mockReturnValue([])
    vi.mocked(registry.executeBeforeSyncHooks).mockResolvedValue(undefined)
    vi.mocked(registry.executeAfterSyncHooks).mockResolvedValue(undefined)
    vi.mocked(scanner.hasEnvExample).mockReturnValue(true)
    vi.mocked(scanner.getRootEnvPaths).mockReturnValue({
      examplePath: '/project/.env.example',
      localPath: '/project/.env.local',
    })
    vi.mocked(parser.parseEnvExample).mockReturnValue({ variables: [] })
    vi.mocked(parser.parseEnvLocal).mockReturnValue({
      values: new Map(),
      comments: new Map(),
      originalContent: '',
    })
    vi.mocked(parser.updateEnvLocalContent).mockReturnValue('')
    vi.mocked(reconciler.getAppSchema).mockReturnValue([])
    vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
      createReconciliationResult(createAppInfo('test'))
    )
    vi.mocked(sources.resolveValue).mockResolvedValue({ value: 'resolved' })
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    vi.restoreAllMocks()
  })

  describe('app discovery', () => {
    it('should find specific app when --app is provided', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)

      await runSync({
        app: 'web',
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(scanner.findWorkspace).toHaveBeenCalledWith('web', expect.any(Object), '/project')
    })

    it('should return 1 when app not found', async () => {
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
      vi.mocked(scanner.findWorkspace).mockResolvedValue(null)

      const result = await runSync({
        app: 'nonexistent',
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printError).toHaveBeenCalledWith('App not found: nonexistent')
      expect(result).toBe(1)
    })

    it('should scan all apps when --all is provided', async () => {
      const apps = [createAppInfo('web'), createAppInfo('api')]
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue(apps)

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(scanner.scanWorkspaces).toHaveBeenCalled()
    })

    it('should return 0 when no apps found', async () => {
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
      vi.mocked(scanner.detectCurrentWorkspace).mockResolvedValue(null)

      const result = await runSync({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printInfo).toHaveBeenCalledWith(
        'No apps with .env.local.example files found.'
      )
      expect(result).toBe(0)
    })

    it('should detect current workspace', async () => {
      const app = createAppInfo('current')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(scanner.detectCurrentWorkspace).mockResolvedValue(app)

      await runSync({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(scanner.detectCurrentWorkspace).toHaveBeenCalled()
    })
  })

  describe('shared variables', () => {
    it('should resolve shared variables from root schema', async () => {
      const app = createAppInfo('web')
      const sharedVar = createVarDef('SHARED_VAR')

      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [sharedVar] }) // root schema
        .mockReturnValue({ variables: [] }) // app schema

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printCheckingShared).toHaveBeenCalled()
    })

    it('should use existing values and not re-prompt', async () => {
      const app = createAppInfo('web')
      const sharedVar = createVarDef('SHARED_VAR')

      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [sharedVar] })
        .mockReturnValue({ variables: [] })
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['SHARED_VAR', 'existing_value']]),
        comments: new Map(),
        originalContent: '',
      })

      await runSync({
        all: true,
        verbose: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      // Should not call resolveValue for existing values
      expect(sources.resolveValue).not.toHaveBeenCalled()
    })

    it('should resolve missing shared variables', async () => {
      const app = createAppInfo('web')
      const sharedVar = createVarDef('MISSING_VAR')

      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [sharedVar] })
        .mockReturnValue({ variables: [] })

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(sources.resolveValue).toHaveBeenCalled()
      expect(reporter.printAdded).toHaveBeenCalledWith('MISSING_VAR', 'placeholder')
    })

    it('should handle skipped variables', async () => {
      const app = createAppInfo('web')
      const sharedVar = createVarDef('SKIP_VAR', 'required')

      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [sharedVar] })
        .mockReturnValue({ variables: [] })
      vi.mocked(sources.resolveValue).mockResolvedValue({ value: '', skipped: true })

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printSkipped).toHaveBeenCalledWith('SKIP_VAR')
    })

    it('should handle optional skipped variables differently', async () => {
      const app = createAppInfo('web')
      const optionalVar = createVarDef('OPT_VAR', 'optional')

      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [optionalVar] })
        .mockReturnValue({ variables: [] })
      vi.mocked(sources.resolveValue).mockResolvedValue({ value: '', skipped: true })

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printMissingOptional).toHaveBeenCalledWith('OPT_VAR')
    })
  })

  describe('app-specific variables', () => {
    it('should process app-specific variables', async () => {
      const app = createAppInfo('web')
      const appVar = createVarDef('APP_VAR')

      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [] }) // root
        .mockReturnValueOnce({ variables: [appVar] }) // app

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printCheckingApp).toHaveBeenCalledWith('web')
    })

    it('should print all ok when no app-specific variables to add', async () => {
      const app = createAppInfo('web')
      const appVar = createVarDef('APP_VAR')

      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [] })
        .mockReturnValueOnce({ variables: [appVar] })
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['APP_VAR', 'value']]),
        comments: new Map(),
        originalContent: '',
      })

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printAllOk).toHaveBeenCalled()
    })

    it('should apply updates for resolved variables', async () => {
      const app = createAppInfo('web')
      const appVar = createVarDef('NEW_VAR')

      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [] })
        .mockReturnValueOnce({ variables: [appVar] })
      vi.mocked(sources.resolveValue).mockResolvedValue({ value: 'new_value' })

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reconciler.applyUpdates).toHaveBeenCalled()
    })
  })

  describe('hooks', () => {
    it('should execute beforeSync hooks', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(registry.executeBeforeSyncHooks).toHaveBeenCalledWith([app])
    })

    it('should execute afterSync hooks', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(registry.executeAfterSyncHooks).toHaveBeenCalled()
    })
  })

  describe('warnings', () => {
    it('should collect and print warnings', async () => {
      const app = createAppInfo('web')
      const sharedVar = createVarDef('WARN_VAR')

      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [sharedVar] })
        .mockReturnValue({ variables: [] })
      vi.mocked(sources.resolveValue).mockResolvedValue({
        value: 'value',
        warning: 'This is a warning',
      })

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printWarning).toHaveBeenCalledWith('This is a warning')
    })

    it('should warn when no root schema', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample).mockReturnValue({ variables: [] })

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printWarning).toHaveBeenCalledWith(
        'No root .env.local.example found. Create one with shared variables.'
      )
    })
  })

  describe('output', () => {
    it('should print header', async () => {
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])

      await runSync({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printHeader).toHaveBeenCalled()
    })

    it('should print summary', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printSummary).toHaveBeenCalled()
    })

    it('should print next steps', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printNextSteps).toHaveBeenCalled()
    })
  })

  describe('overrides', () => {
    it('should report overridden shared variables', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample).mockReturnValue({ variables: [] })
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app, {
          overrides: new Map([['SHARED_VAR', 'override_value']]),
        })
      )

      await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printOverride).toHaveBeenCalledWith('SHARED_VAR')
    })
  })

  describe('force mode', () => {
    it('should set interactive to false when force is true', async () => {
      const app = createAppInfo('web')
      const sharedVar = createVarDef('VAR')

      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [sharedVar] })
        .mockReturnValue({ variables: [] })

      await runSync({
        all: true,
        force: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(sources.resolveValue).toHaveBeenCalledWith(
        sharedVar,
        expect.objectContaining({ interactive: false })
      )
    })
  })

  describe('return value', () => {
    it('should always return 0', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])

      const result = await runSync({
        all: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(result).toBe(0)
    })
  })
})
