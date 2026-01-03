import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runStatus } from '@/commands/status.js'
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

describe('status command', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(registry.getValueSources).mockReturnValue([])
    vi.mocked(scanner.hasEnvExample).mockReturnValue(true)
    vi.mocked(scanner.getRootEnvPaths).mockReturnValue({
      examplePath: '/project/.env.example',
      localPath: '/project/.env.local',
    })
    vi.mocked(parser.parseEnvLocal).mockReturnValue({
      values: new Map(),
      comments: new Map(),
      originalContent: '',
    })
    vi.mocked(reconciler.getAppSchema).mockReturnValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('app discovery', () => {
    it('should find specific app when --app is provided', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app)
      )

      await runStatus({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(scanner.findWorkspace).toHaveBeenCalledWith('web', {}, '/project')
    })

    it('should return 1 when app not found', async () => {
      vi.mocked(scanner.findWorkspace).mockResolvedValue(null)

      const result = await runStatus({
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
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(apps[0])
      )

      await runStatus({
        all: true,
        rootDir: '/project',
        config: {},
      })

      expect(scanner.scanWorkspaces).toHaveBeenCalled()
    })

    it('should return 0 when no apps found', async () => {
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
      vi.mocked(scanner.detectCurrentWorkspace).mockResolvedValue(null)

      const result = await runStatus({
        all: true,
        rootDir: '/project',
        config: {},
      })

      expect(result).toBe(0)
    })

    it('should not print info when quiet and no apps', async () => {
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
      vi.mocked(scanner.detectCurrentWorkspace).mockResolvedValue(null)

      await runStatus({
        all: true,
        quiet: true,
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printInfo).not.toHaveBeenCalled()
    })
  })

  describe('status reporting', () => {
    it('should return 1 when missing required variables', async () => {
      const app = createAppInfo('web')
      const missingVar = createVarDef('MISSING', 'required')

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app, { missing: [missingVar] })
      )

      const result = await runStatus({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(result).toBe(1)
    })

    it('should return 0 when only optional variables missing', async () => {
      const app = createAppInfo('web')
      const optionalVar = createVarDef('OPTIONAL', 'optional')

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app, { missing: [optionalVar] })
      )

      const result = await runStatus({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(result).toBe(0)
    })

    it('should print full status report when not quiet', async () => {
      const app = createAppInfo('web')

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app)
      )

      await runStatus({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printStatusReport).toHaveBeenCalled()
    })

    it('should print postinstall ok when quiet and no missing', async () => {
      const app = createAppInfo('web')

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app)
      )

      await runStatus({
        app: 'web',
        quiet: true,
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printPostinstallOk).toHaveBeenCalled()
    })

    it('should print postinstall action needed when quiet and missing', async () => {
      const app = createAppInfo('web')
      const missingRequired = createVarDef('REQ', 'required')
      const missingOptional = createVarDef('OPT', 'optional')

      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.compareSchemaToActual).mockReturnValue(
        createReconciliationResult(app, { missing: [missingRequired, missingOptional] })
      )

      await runStatus({
        app: 'web',
        quiet: true,
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printPostinstallActionNeeded).toHaveBeenCalledWith(1, 1)
    })
  })
})
