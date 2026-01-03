import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runExport } from '@/commands/export.js'
import type { AppInfo, EnvVarDefinition } from '@/core/types.js'

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

describe('export command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(registry.getValueSources).mockReturnValue([])
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
    vi.mocked(reconciler.getAppSchema).mockReturnValue([])
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    vi.restoreAllMocks()
  })

  describe('JSON format', () => {
    it('should export all apps in JSON format by default', async () => {
      const apps = [createAppInfo('web'), createAppInfo('api')]
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue(apps)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([
        createVarDef('VAR1', 'required'),
        createVarDef('VAR2', 'optional'),
      ])

      const result = await runExport({
        format: 'json',
        rootDir: '/project',
        config: {},
      })

      expect(result).toBe(0)
      expect(consoleLogSpy).toHaveBeenCalled()
      const output = JSON.parse(consoleLogSpy.mock.calls[0][0])
      expect(output).toHaveProperty('web')
      expect(output).toHaveProperty('api')
      expect(output.web.required).toContain('VAR1')
      expect(output.web.optional).toContain('VAR2')
    })

    it('should return 1 when no apps found for JSON', async () => {
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])

      const result = await runExport({
        format: 'json',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printError).toHaveBeenCalledWith(
        'No apps with .env.local.example files found.'
      )
      expect(result).toBe(1)
    })

    it('should export specific app in JSON format', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([createVarDef('VAR1')])

      await runExport({
        app: 'web',
        format: 'json',
        rootDir: '/project',
        config: {},
      })

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0])
      expect(Object.keys(output)).toEqual(['web'])
    })

    it('should separate app-specific and shared variables', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('SHARED_VAR')],
      })
      vi.mocked(reconciler.getAppSchema).mockReturnValue([
        createVarDef('SHARED_VAR'),
        createVarDef('APP_VAR'),
      ])

      await runExport({
        app: 'web',
        format: 'json',
        rootDir: '/project',
        config: {},
      })

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0])
      expect(output.web.shared).toContain('SHARED_VAR')
      expect(output.web.appSpecific).toContain('APP_VAR')
    })
  })

  describe('values format', () => {
    it('should export key=value pairs', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([
        createVarDef('VAR1'),
        createVarDef('VAR2'),
      ])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([
          ['VAR1', 'value1'],
          ['VAR2', 'value2'],
        ]),
        comments: new Map(),
        originalContent: '',
      })

      await runExport({
        app: 'web',
        format: 'values',
        rootDir: '/project',
        config: {},
      })

      expect(consoleLogSpy).toHaveBeenCalledWith('VAR1=value1')
      expect(consoleLogSpy).toHaveBeenCalledWith('VAR2=value2')
    })

    it('should skip empty values', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([
        createVarDef('VAR1'),
        createVarDef('EMPTY'),
      ])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([
          ['VAR1', 'value1'],
          ['EMPTY', ''],
        ]),
        comments: new Map(),
        originalContent: '',
      })

      await runExport({
        app: 'web',
        format: 'values',
        rootDir: '/project',
        config: {},
      })

      expect(consoleLogSpy).toHaveBeenCalledTimes(1)
      expect(consoleLogSpy).toHaveBeenCalledWith('VAR1=value1')
    })
  })

  describe('shell format', () => {
    it('should export as shell export statements', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([createVarDef('VAR1')])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['VAR1', 'value1']]),
        comments: new Map(),
        originalContent: '',
      })

      await runExport({
        app: 'web',
        format: 'shell',
        rootDir: '/project',
        config: {},
      })

      expect(consoleLogSpy).toHaveBeenCalledWith("export VAR1='value1'")
    })

    it('should escape single quotes in shell format', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([createVarDef('VAR1')])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['VAR1', "value'with'quotes"]]),
        comments: new Map(),
        originalContent: '',
      })

      await runExport({
        app: 'web',
        format: 'shell',
        rootDir: '/project',
        config: {},
      })

      expect(consoleLogSpy).toHaveBeenCalledWith("export VAR1='value'\\''with'\\''quotes'")
    })
  })

  describe('vercel format', () => {
    it('should export in Vercel format', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(reconciler.getAppSchema).mockReturnValue([createVarDef('VAR1')])
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['VAR1', 'value1']]),
        comments: new Map(),
        originalContent: '',
      })

      await runExport({
        app: 'web',
        format: 'vercel',
        rootDir: '/project',
        config: {},
      })

      expect(consoleLogSpy).toHaveBeenCalledWith('VAR1="value1"')
    })
  })

  describe('error handling', () => {
    it('should return 1 when app not found', async () => {
      vi.mocked(scanner.findWorkspace).mockResolvedValue(null)

      const result = await runExport({
        app: 'nonexistent',
        format: 'values',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printError).toHaveBeenCalledWith('App not found: nonexistent')
      expect(result).toBe(1)
    })

    it('should return 1 when no current app detected for non-json', async () => {
      vi.mocked(scanner.detectCurrentWorkspace).mockResolvedValue(null)

      const result = await runExport({
        format: 'values',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printError).toHaveBeenCalledWith(
        'Could not detect current app. Use --app to specify.'
      )
      expect(result).toBe(1)
    })

    it('should return 1 when app has no env example', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(scanner.hasEnvExample).mockReturnValue(false)

      const result = await runExport({
        app: 'web',
        format: 'values',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printError).toHaveBeenCalledWith(
        'App web has no .env.local.example file.'
      )
      expect(result).toBe(1)
    })

    it('should return 1 for unknown format', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)

      const result = await runExport({
        app: 'web',
        format: 'unknown',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printError).toHaveBeenCalledWith(
        'Unknown format: unknown. Use: json, vercel, shell, or values'
      )
      expect(result).toBe(1)
    })
  })
})
