import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as reporter from '@/core/reporter.js'
import type { ReconciliationResult, AppInfo, EnvVarDefinition } from '@/core/types.js'

describe('reporter', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Disable colors for predictable output
    reporter.setColorsEnabled(false)
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    reporter.setColorsEnabled(true)
  })

  describe('setColorsEnabled', () => {
    it('should enable and disable colors', () => {
      reporter.setColorsEnabled(true)
      reporter.printHeader()
      const withColors = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')

      consoleLogSpy.mockClear()

      reporter.setColorsEnabled(false)
      reporter.printHeader()
      const withoutColors = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')

      // Without colors, there should be no ANSI escape codes
      expect(withoutColors).not.toMatch(/\x1b\[/)
    })
  })

  describe('basic output', () => {
    it('should print header', () => {
      reporter.printHeader()
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('env-vars-doctor')
    })

    it('should print checking shared', () => {
      reporter.printCheckingShared()
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('shared'))
    })

    it('should print checking app', () => {
      reporter.printCheckingApp('my-app')
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('my-app'))
    })
  })

  describe('variable status', () => {
    it('should print valid variable without source', () => {
      reporter.printValid('DATABASE_URL')
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✓'))
    })

    it('should print valid variable with source', () => {
      reporter.printValid('DATABASE_URL', 'plugin')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('DATABASE_URL')
      expect(output).toContain('plugin')
    })

    it('should print computed variable with short value', () => {
      reporter.printComputed('PORT', '3000')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('PORT')
      expect(output).toContain('3000')
      expect(output).toContain('computed')
    })

    it('should print computed variable with truncated long value', () => {
      const longValue = 'a'.repeat(50)
      reporter.printComputed('SECRET', longValue)
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('...')
    })

    it('should print missing required variable', () => {
      reporter.printMissingRequired('API_KEY')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('API_KEY')
      expect(output).toContain('missing')
      expect(output).toContain('required')
    })

    it('should print missing optional variable', () => {
      reporter.printMissingOptional('OPTIONAL_VAR')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('OPTIONAL_VAR')
      expect(output).toContain('optional')
    })

    it('should print deprecated variable', () => {
      reporter.printDeprecated('OLD_VAR')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('OLD_VAR')
      expect(output).toContain('deprecated')
    })

    it('should print extra variable', () => {
      reporter.printExtra('UNKNOWN_VAR')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('UNKNOWN_VAR')
      expect(output).toContain('not in schema')
    })

    it('should print override variable', () => {
      reporter.printOverride('SHARED_VAR')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('SHARED_VAR')
      expect(output).toContain('overrides shared')
    })

    it('should print added variable', () => {
      reporter.printAdded('NEW_VAR', 'prompt')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('NEW_VAR')
      expect(output).toContain('added via prompt')
    })

    it('should print skipped variable', () => {
      reporter.printSkipped('SKIPPED_VAR')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('SKIPPED_VAR')
      expect(output).toContain('skipped')
    })

    it('should print all ok message', () => {
      reporter.printAllOk(5)
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('All 5 variables')
    })
  })

  describe('messages', () => {
    it('should print warning', () => {
      reporter.printWarning('Something went wrong')
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Something went wrong'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('⚠'))
    })

    it('should print error', () => {
      reporter.printError('Fatal error')
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Fatal error'))
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('✗'))
    })

    it('should print info', () => {
      reporter.printInfo('Helpful information')
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Helpful information'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('ℹ'))
    })
  })

  describe('summary', () => {
    it('should print basic summary', () => {
      reporter.printSummary(3, 0, 0, 0)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('Summary')
      expect(output).toContain('3 apps checked')
    })

    it('should print summary with singular app', () => {
      reporter.printSummary(1, 0, 0, 0)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('1 app checked')
    })

    it('should print summary with variables added', () => {
      reporter.printSummary(1, 5, 0, 0)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('5')
      expect(output).toContain('variables added')
    })

    it('should print summary with singular variable added', () => {
      reporter.printSummary(1, 1, 0, 0)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('1')
      expect(output).toContain('variable added')
    })

    it('should print summary with variables skipped', () => {
      reporter.printSummary(1, 0, 3, 0)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('3 optional variables skipped')
    })

    it('should print summary with warnings', () => {
      reporter.printSummary(1, 0, 0, 2)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('2 warnings')
    })
  })

  describe('status report', () => {
    const createAppInfo = (name: string): AppInfo => ({
      name,
      path: `/apps/${name}`,
      envExamplePath: `/apps/${name}/.env.example`,
      envLocalPath: `/apps/${name}/.env.local`,
    })

    const createVarDef = (
      name: string,
      requirement: 'required' | 'optional' = 'required'
    ): EnvVarDefinition => ({
      name,
      exampleValue: '',
      requirement,
      directive: { type: 'placeholder' },
      description: '',
      rawComment: '',
    })

    it('should print status report header', () => {
      reporter.printStatusReport([])
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('Environment Status Report')
    })

    it('should print app name', () => {
      const result: ReconciliationResult = {
        app: createAppInfo('web'),
        valid: [],
        missing: [],
        extra: [],
        deprecated: [],
        overrides: new Map(),
      }
      reporter.printStatusReport([result])
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('web')
    })

    it('should print valid variables count', () => {
      const result: ReconciliationResult = {
        app: createAppInfo('web'),
        valid: [createVarDef('VAR1'), createVarDef('VAR2')],
        missing: [],
        extra: [],
        deprecated: [],
        overrides: new Map(),
      }
      reporter.printStatusReport([result])
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('2')
      expect(output).toContain('configured')
    })

    it('should print missing required variables', () => {
      const result: ReconciliationResult = {
        app: createAppInfo('web'),
        valid: [],
        missing: [createVarDef('MISSING_VAR', 'required')],
        extra: [],
        deprecated: [],
        overrides: new Map(),
      }
      reporter.printStatusReport([result])
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('1')
      expect(output).toContain('required missing')
      expect(output).toContain('MISSING_VAR')
    })

    it('should print missing optional variables', () => {
      const result: ReconciliationResult = {
        app: createAppInfo('web'),
        valid: [],
        missing: [createVarDef('OPT_VAR', 'optional')],
        extra: [],
        deprecated: [],
        overrides: new Map(),
      }
      reporter.printStatusReport([result])
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('optional missing')
      expect(output).toContain('OPT_VAR')
    })

    it('should print overrides', () => {
      const result: ReconciliationResult = {
        app: createAppInfo('web'),
        valid: [],
        missing: [],
        extra: [],
        deprecated: [],
        overrides: new Map([['SHARED_VAR', 'local_value']]),
      }
      reporter.printStatusReport([result])
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('overriding shared')
      expect(output).toContain('SHARED_VAR')
    })

    it('should print deprecated variables', () => {
      const result: ReconciliationResult = {
        app: createAppInfo('web'),
        valid: [],
        missing: [],
        extra: [],
        deprecated: ['OLD_VAR'],
        overrides: new Map(),
      }
      reporter.printStatusReport([result])
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('deprecated')
      expect(output).toContain('OLD_VAR')
    })

    it('should print extra variables', () => {
      const result: ReconciliationResult = {
        app: createAppInfo('web'),
        valid: [],
        missing: [],
        extra: ['UNKNOWN_VAR'],
        deprecated: [],
        overrides: new Map(),
      }
      reporter.printStatusReport([result])
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('extra')
      expect(output).toContain('not in schema')
      expect(output).toContain('UNKNOWN_VAR')
    })
  })

  describe('help messages', () => {
    it('should print next steps with warnings', () => {
      reporter.printNextSteps(true)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('status')
    })

    it('should not print next steps without warnings', () => {
      reporter.printNextSteps(false)
      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('should print next steps with custom command', () => {
      reporter.printNextSteps(true, 'npx env-doctor')
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('npx env-doctor')
    })

    it('should print nothing to do', () => {
      reporter.printNothingToDo()
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('All environment variables are configured')
    })
  })

  describe('postinstall messages', () => {
    it('should print postinstall action needed with required', () => {
      reporter.printPostinstallActionNeeded(3, 0)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('3 required variables missing')
      expect(output).toContain('env-vars-doctor sync')
    })

    it('should print postinstall action needed with optional', () => {
      reporter.printPostinstallActionNeeded(0, 2)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('2 optional variables missing')
    })

    it('should print postinstall action needed with singular', () => {
      reporter.printPostinstallActionNeeded(1, 1)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('1 required variable missing')
      expect(output).toContain('1 optional variable missing')
    })

    it('should print postinstall ok', () => {
      reporter.printPostinstallOk()
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('Environment ready')
    })
  })

  describe('CI mode', () => {
    it('should print CI header', () => {
      reporter.printCiHeader()
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('env-vars-doctor')
      expect(output).toContain('CI')
    })

    it('should print CI checking section', () => {
      reporter.printCiCheckingSection('web')
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('web'))
    })

    it('should print CI present', () => {
      reporter.printCiPresent('DATABASE_URL')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('DATABASE_URL')
      expect(output).toContain('✓')
    })

    it('should print CI missing required', () => {
      reporter.printCiMissingRequired('API_KEY')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('API_KEY')
      expect(output).toContain('missing')
      expect(output).toContain('required')
    })

    it('should print CI missing optional', () => {
      reporter.printCiMissingOptional('OPTIONAL_VAR')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('OPTIONAL_VAR')
      expect(output).toContain('optional')
    })

    it('should print CI skipped', () => {
      reporter.printCiSkipped('LOCAL_VAR', 'local-only')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('LOCAL_VAR')
      expect(output).toContain('local-only')
    })

    it('should print CI summary with no missing', () => {
      reporter.printCiSummary('web', 5, 0, 0)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('All 5 required variables present')
      expect(output).toContain('web')
    })

    it('should print CI summary with missing required', () => {
      reporter.printCiSummary('web', 5, 2, 0)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('2 required variables missing')
      expect(output).toContain('Build will fail')
    })

    it('should print CI summary with singular missing', () => {
      reporter.printCiSummary('web', 5, 1, 0)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('1 required variable missing')
    })

    it('should print CI summary with missing optional', () => {
      reporter.printCiSummary('web', 5, 0, 3)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('3 optional variables not set')
    })
  })

  describe('diagnose mode', () => {
    it('should print diagnose header', () => {
      reporter.printDiagnoseHeader()
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('env-vars-doctor diagnose')
    })

    it('should print diagnose scanning', () => {
      reporter.printDiagnoseScanning('apps/web')
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('apps/web'))
    })

    it('should print diagnose scan complete', () => {
      reporter.printDiagnoseScanComplete(50, 20)
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('50 files')
      expect(output).toContain('20 env variable')
    })

    it('should print diagnose missing', () => {
      reporter.printDiagnoseMissing('UNDOCUMENTED_VAR', 3, {
        file: 'src/index.ts',
        line: 42,
      })
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('UNDOCUMENTED_VAR')
      expect(output).toContain('3 usages')
      expect(output).toContain('src/index.ts:42')
    })

    it('should print diagnose missing with singular usage', () => {
      reporter.printDiagnoseMissing('UNDOCUMENTED_VAR', 1, {
        file: 'src/index.ts',
        line: 42,
      })
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('1 usage')
    })

    it('should print diagnose unused', () => {
      reporter.printDiagnoseUnused('UNUSED_VAR')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('UNUSED_VAR')
      expect(output).toContain('not found in source')
    })

    it('should print diagnose section', () => {
      reporter.printDiagnoseSection('Missing from schema')
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Missing from schema'))
    })

    it('should print diagnose no issues', () => {
      reporter.printDiagnoseNoIssues('All variables documented')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('All variables documented')
      expect(output).toContain('✓')
    })

    it('should print diagnose summary with no issues', () => {
      reporter.printDiagnoseSummary(0, 0, 10)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('10 variables properly defined')
    })

    it('should print diagnose summary with missing', () => {
      reporter.printDiagnoseSummary(3, 0, 10)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('3')
      expect(output).toContain('used but not in .env.example')
    })

    it('should print diagnose summary with unused', () => {
      reporter.printDiagnoseSummary(0, 2, 10)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('2')
      expect(output).toContain('in schema but not used')
    })

    it('should print diagnose next steps with missing', () => {
      reporter.printDiagnoseNextSteps(true)
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('Add missing variables')
      expect(output).toContain('.env.example')
    })

    it('should print diagnose next steps with custom file name', () => {
      reporter.printDiagnoseNextSteps(true, '.env.local.example')
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('.env.local.example')
    })

    it('should not print diagnose next steps without missing', () => {
      reporter.printDiagnoseNextSteps(false)
      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('should print diagnose usage location', () => {
      reporter.printDiagnoseUsageLocation('src/utils.ts', 15, 'process.env.MY_VAR')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('src/utils.ts:15')
      expect(output).toContain('process.env.MY_VAR')
    })
  })

  describe('plugin messages', () => {
    it('should print plugin not available', () => {
      reporter.printPluginNotAvailable('supabase', 'Supabase CLI not found')
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
      expect(output).toContain('supabase')
      expect(output).toContain('Supabase CLI not found')
    })

    it('should print plugin action', () => {
      reporter.printPluginAction('vercel', 'Fetching environment variables')
      const output = consoleLogSpy.mock.calls[0][0]
      expect(output).toContain('[vercel]')
      expect(output).toContain('Fetching environment variables')
    })
  })

  describe('colors enabled', () => {
    it('should include ANSI codes when colors enabled', () => {
      reporter.setColorsEnabled(true)
      reporter.printError('Error message')
      const output = consoleErrorSpy.mock.calls[0][0]
      // Should contain ANSI escape codes
      expect(output).toMatch(/\x1b\[/)
    })
  })
})
