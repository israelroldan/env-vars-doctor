import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runDiagnose } from '@/commands/diagnose.js'
import type { AppInfo, EnvVarDefinition } from '@/core/types.js'
import type { SourceScanResult, DiagnoseResult } from '@/core/source-scanner.js'

// Mock all dependencies
vi.mock('@/core/scanner.js')
vi.mock('@/core/parser.js')
vi.mock('@/core/source-scanner.js')
vi.mock('@/plugins/registry.js')
vi.mock('@/core/reporter.js')

import * as scanner from '@/core/scanner.js'
import * as parser from '@/core/parser.js'
import * as sourceScanner from '@/core/source-scanner.js'
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

function createScanResult(overrides: Partial<SourceScanResult> = {}): SourceScanResult {
  return {
    usedVars: new Map(),
    filesScanned: 10,
    linesScanned: 100,
    ...overrides,
  }
}

function createDiagnoseResult(overrides: Partial<DiagnoseResult> = {}): DiagnoseResult {
  return {
    missing: new Map(),
    unused: new Set(),
    defined: new Set(),
    ...overrides,
  }
}

function createEnvSchema(variables: EnvVarDefinition[] = [], filePath = '/project/.env.example') {
  return { filePath, variables }
}

describe('diagnose command', () => {
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
    vi.mocked(parser.parseEnvExample).mockReturnValue(createEnvSchema())
    vi.mocked(sourceScanner.scanAppSources).mockReturnValue(createScanResult())
    vi.mocked(sourceScanner.scanPackageSources).mockReturnValue(createScanResult())
    vi.mocked(sourceScanner.mergeScanResults).mockReturnValue(createScanResult())
    vi.mocked(sourceScanner.diagnoseEnvUsage).mockReturnValue(createDiagnoseResult())
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    vi.restoreAllMocks()
  })

  describe('app discovery', () => {
    it('should find specific app when --app is provided', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)

      await runDiagnose({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(scanner.findWorkspace).toHaveBeenCalledWith('web', {}, '/project')
    })

    it('should return 1 when app not found', async () => {
      vi.mocked(scanner.findWorkspace).mockResolvedValue(null)

      const result = await runDiagnose({
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

      await runDiagnose({
        all: true,
        rootDir: '/project',
        config: {},
      })

      expect(scanner.scanWorkspaces).toHaveBeenCalled()
      expect(sourceScanner.scanAppSources).toHaveBeenCalledTimes(2)
    })

    it('should detect current workspace when no options', async () => {
      const app = createAppInfo('current')
      vi.mocked(scanner.detectCurrentWorkspace).mockResolvedValue(app)

      await runDiagnose({
        rootDir: '/project',
        config: {},
      })

      expect(scanner.detectCurrentWorkspace).toHaveBeenCalled()
    })
  })

  describe('source scanning', () => {
    it('should scan app sources', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)

      await runDiagnose({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(sourceScanner.scanAppSources).toHaveBeenCalledWith(app, {})
      expect(reporter.printDiagnoseScanning).toHaveBeenCalledWith('web')
    })

    it('should scan packages sources', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)

      await runDiagnose({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(sourceScanner.scanPackageSources).toHaveBeenCalledWith('/project', {})
      expect(reporter.printDiagnoseScanning).toHaveBeenCalledWith('packages')
    })

    it('should report scan completion', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(sourceScanner.scanAppSources).mockReturnValue(
        createScanResult({ filesScanned: 50, usedVars: new Map([['VAR1', []]]) })
      )

      await runDiagnose({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printDiagnoseScanComplete).toHaveBeenCalledWith(50, 1)
    })
  })

  describe('diagnosis reporting', () => {
    it('should report missing variables', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(sourceScanner.diagnoseEnvUsage).mockReturnValue(
        createDiagnoseResult({
          missing: new Map([['UNDOCUMENTED', [{ file: 'src/index.ts', line: 10, pattern: 'process.env.UNDOCUMENTED' }]]]),
        })
      )

      await runDiagnose({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printDiagnoseMissing).toHaveBeenCalledWith(
        'UNDOCUMENTED',
        1,
        { file: 'src/index.ts', line: 10, pattern: 'process.env.UNDOCUMENTED' }
      )
    })

    it('should report no missing when all documented', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(sourceScanner.diagnoseEnvUsage).mockReturnValue(createDiagnoseResult())

      await runDiagnose({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printDiagnoseNoIssues).toHaveBeenCalledWith(
        'All used variables are documented'
      )
    })

    it('should report unused variables', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(sourceScanner.diagnoseEnvUsage).mockReturnValue(
        createDiagnoseResult({
          unused: new Set(['UNUSED_VAR']),
        })
      )

      await runDiagnose({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printDiagnoseUnused).toHaveBeenCalledWith('UNUSED_VAR')
    })

    it('should report no unused when all used', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(sourceScanner.diagnoseEnvUsage).mockReturnValue(createDiagnoseResult())

      await runDiagnose({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printDiagnoseNoIssues).toHaveBeenCalledWith(
        'All schema variables are used'
      )
    })

    it('should show verbose usage locations', async () => {
      const app = createAppInfo('web')
      const usages = [
        { file: 'src/a.ts', line: 1, pattern: 'p1' },
        { file: 'src/b.ts', line: 2, pattern: 'p2' },
      ]
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(sourceScanner.diagnoseEnvUsage).mockReturnValue(
        createDiagnoseResult({
          missing: new Map([['VAR', usages]]),
        })
      )

      await runDiagnose({
        app: 'web',
        verbose: true,
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printDiagnoseUsageLocation).toHaveBeenCalledTimes(2)
    })

    it('should truncate verbose output to 3 usages', async () => {
      const app = createAppInfo('web')
      const usages = [
        { file: 'a.ts', line: 1, pattern: '' },
        { file: 'b.ts', line: 2, pattern: '' },
        { file: 'c.ts', line: 3, pattern: '' },
        { file: 'd.ts', line: 4, pattern: '' },
        { file: 'e.ts', line: 5, pattern: '' },
      ]
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(sourceScanner.diagnoseEnvUsage).mockReturnValue(
        createDiagnoseResult({
          missing: new Map([['VAR', usages]]),
        })
      )

      await runDiagnose({
        app: 'web',
        verbose: true,
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printDiagnoseUsageLocation).toHaveBeenCalledTimes(3)
      expect(consoleLogSpy).toHaveBeenCalledWith('    ... and 2 more')
    })
  })

  describe('exit codes', () => {
    it('should return 1 when missing variables found', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(sourceScanner.diagnoseEnvUsage).mockReturnValue(
        createDiagnoseResult({
          missing: new Map([['VAR', []]]),
        })
      )

      const result = await runDiagnose({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(result).toBe(1)
    })

    it('should return 0 when no missing variables', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(sourceScanner.diagnoseEnvUsage).mockReturnValue(createDiagnoseResult())

      const result = await runDiagnose({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(result).toBe(0)
    })
  })

  describe('output', () => {
    it('should print diagnose header', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)

      await runDiagnose({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printDiagnoseHeader).toHaveBeenCalled()
    })

    it('should print summary', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(sourceScanner.diagnoseEnvUsage).mockReturnValue(
        createDiagnoseResult({
          missing: new Map([['M1', []]]),
          unused: new Set(['U1', 'U2']),
          defined: new Set(['D1', 'D2', 'D3']),
        })
      )

      await runDiagnose({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printDiagnoseSummary).toHaveBeenCalledWith(1, 2, 3)
    })

    it('should print next steps when missing', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(sourceScanner.diagnoseEnvUsage).mockReturnValue(
        createDiagnoseResult({
          missing: new Map([['M1', []]]),
        })
      )

      await runDiagnose({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printDiagnoseNextSteps).toHaveBeenCalledWith(true, '.env.local.example')
    })
  })
})
