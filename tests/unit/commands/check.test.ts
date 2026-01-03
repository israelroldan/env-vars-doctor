import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runCheck } from '@/commands/check.js'
import type { AppInfo, EnvVarDefinition, ReconciliationResult } from '@/core/types.js'

// Mock all dependencies
vi.mock('@/core/scanner.js')
vi.mock('@/core/parser.js')
vi.mock('@/core/reconciler.js')
vi.mock('@/plugins/registry.js')
vi.mock('@/core/reporter.js')

import * as scanner from '@/core/scanner.js'
import * as parser from '@/core/parser.js'
import * as reconciler from '@/core/reconciler.js'
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

describe('check command', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(registry.getValueSources).mockReturnValue([])
    vi.mocked(scanner.hasEnvExample).mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('app discovery', () => {
    it('should find specific app when --app is provided', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app, { valid: [createVarDef('VAR')] })
      )

      const result = await runCheck({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(scanner.findWorkspace).toHaveBeenCalledWith('web', {}, '/project')
      expect(result).toBe(0)
    })

    it('should return 1 when app not found', async () => {
      vi.mocked(scanner.findWorkspace).mockResolvedValue(null)

      const result = await runCheck({
        app: 'nonexistent',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printError).toHaveBeenCalledWith('App not found: nonexistent')
      expect(result).toBe(1)
    })

    it('should scan all apps when --all is provided', async () => {
      const apps = [createAppInfo('web'), createAppInfo('api')]
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue(apps)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(apps[0], { valid: [createVarDef('VAR')] })
      )

      await runCheck({
        all: true,
        rootDir: '/project',
        config: {},
      })

      expect(scanner.scanWorkspaces).toHaveBeenCalledWith({}, '/project')
      expect(reporter.printCheckingApp).toHaveBeenCalledTimes(2)
    })

    it('should detect current workspace when no options provided', async () => {
      const app = createAppInfo('current')
      vi.mocked(scanner.detectCurrentWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app, { valid: [createVarDef('VAR')] })
      )

      await runCheck({
        rootDir: '/project',
        config: {},
      })

      expect(scanner.detectCurrentWorkspace).toHaveBeenCalled()
    })

    it('should fall back to scanning all when no current workspace', async () => {
      vi.mocked(scanner.detectCurrentWorkspace).mockResolvedValue(null)
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([createAppInfo('web')])
      vi.mocked(reconciler.getAppSchema).mockReturnValue([])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(createAppInfo('web'), { valid: [createVarDef('VAR')] })
      )

      await runCheck({
        rootDir: '/project',
        config: {},
      })

      expect(scanner.scanWorkspaces).toHaveBeenCalled()
    })

    it('should return 0 when no apps found', async () => {
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
      vi.mocked(scanner.detectCurrentWorkspace).mockResolvedValue(null)

      const result = await runCheck({
        all: true,
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printInfo).toHaveBeenCalledWith(
        'No apps with .env.local.example files found.'
      )
      expect(result).toBe(0)
    })
  })

  describe('checking variables', () => {
    it('should report missing required variables', async () => {
      const app = createAppInfo('web')
      const missingVar = createVarDef('MISSING_VAR', 'required')

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([missingVar])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app, { missing: [missingVar] })
      )

      const result = await runCheck({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printMissingRequired).toHaveBeenCalledWith('MISSING_VAR')
      expect(reporter.printError).toHaveBeenCalledWith(
        'Some required environment variables are missing.'
      )
      expect(result).toBe(1)
    })

    it('should report missing optional variables when verbose', async () => {
      const app = createAppInfo('web')
      const optionalVar = createVarDef('OPTIONAL_VAR', 'optional')

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([optionalVar])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app, {
          missing: [optionalVar],
          valid: [createVarDef('VALID')],
        })
      )

      await runCheck({
        app: 'web',
        verbose: true,
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printMissingOptional).toHaveBeenCalledWith('OPTIONAL_VAR')
    })

    it('should not report optional variables without verbose', async () => {
      const app = createAppInfo('web')
      const optionalVar = createVarDef('OPTIONAL_VAR', 'optional')

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([optionalVar])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app, {
          missing: [optionalVar],
          valid: [createVarDef('VALID')],
        })
      )

      await runCheck({
        app: 'web',
        verbose: false,
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printMissingOptional).not.toHaveBeenCalled()
    })

    it('should report deprecated variables', async () => {
      const app = createAppInfo('web')

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app, {
          deprecated: ['OLD_VAR'],
          valid: [createVarDef('VALID')],
        })
      )

      await runCheck({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printDeprecated).toHaveBeenCalledWith('OLD_VAR')
    })

    it('should print all ok when no missing required', async () => {
      const app = createAppInfo('web')
      const validVars = [createVarDef('VAR1'), createVarDef('VAR2')]

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.getAppSchema).mockReturnValue(validVars)
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([
          ['VAR1', 'value1'],
          ['VAR2', 'value2'],
        ]),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app, { valid: validVars })
      )

      const result = await runCheck({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printAllOk).toHaveBeenCalledWith(2)
      expect(reporter.printNothingToDo).toHaveBeenCalled()
      expect(result).toBe(0)
    })
  })

  describe('output', () => {
    it('should print header', async () => {
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
      vi.mocked(scanner.detectCurrentWorkspace).mockResolvedValue(null)

      await runCheck({
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printHeader).toHaveBeenCalled()
    })

    it('should print next steps on error', async () => {
      const app = createAppInfo('web')
      const missingVar = createVarDef('MISSING', 'required')

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([missingVar])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map(),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app, { missing: [missingVar] })
      )

      await runCheck({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printNextSteps).toHaveBeenCalledWith(true)
    })
  })
})
