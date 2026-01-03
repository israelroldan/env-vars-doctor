import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import { runDeploy } from '@/commands/deploy.js'
import type { AppInfo, EnvVarDefinition } from '@/core/types.js'

// Mock all dependencies
vi.mock('node:fs')
vi.mock('@/core/scanner.js')
vi.mock('@/core/parser.js')
vi.mock('@/core/reporter.js')

import * as fs from 'node:fs'
import * as scanner from '@/core/scanner.js'
import * as parser from '@/core/parser.js'
import * as reporter from '@/core/reporter.js'

// Mock readline
const mockQuestion = vi.fn()
const mockClose = vi.fn()
vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: mockClose,
  })),
}))

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Helpers
function createAppInfo(name: string): AppInfo {
  return {
    name,
    path: `/apps/${name}`,
    envExamplePath: `/apps/${name}/.env.example`,
    envLocalPath: `/apps/${name}/.env.local`,
  }
}

function createVarDef(name: string): EnvVarDefinition {
  return {
    name,
    exampleValue: '',
    requirement: 'required',
    directive: { type: 'placeholder' },
    description: '',
    rawComment: '',
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

function createFetchResponse(data: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

describe('deploy command', () => {
  const originalEnv = process.env
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    process.env = {
      ...originalEnv,
      VERCEL_TOKEN: 'test-token',
      VERCEL_TEAM_ID: 'test-team-id',
    }
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
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
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.readFileSync).mockReturnValue('')
    vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
    vi.mocked(scanner.hasEnvExample).mockReturnValue(true)
    mockFetch.mockResolvedValue(createFetchResponse({ data: [] }))
  })

  afterEach(() => {
    process.env = originalEnv
    consoleLogSpy.mockRestore()
    vi.restoreAllMocks()
  })

  describe('authentication', () => {
    it('should fail when VERCEL_TOKEN is missing', async () => {
      delete process.env.VERCEL_TOKEN

      const result = await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printError).toHaveBeenCalledWith(
        'VERCEL_TOKEN and VERCEL_TEAM_ID are required for deploy command'
      )
      expect(result).toBe(1)
    })

    it('should fail when VERCEL_TEAM_ID is missing', async () => {
      delete process.env.VERCEL_TEAM_ID

      const result = await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printError).toHaveBeenCalledWith(
        'VERCEL_TOKEN and VERCEL_TEAM_ID are required for deploy command'
      )
      expect(result).toBe(1)
    })
  })

  describe('shared env vars check', () => {
    it('should report all shared vars configured correctly', async () => {
      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('SHARED_VAR')],
      })
      mockFetch.mockResolvedValue(
        createFetchResponse({
          data: [
            {
              id: '1',
              key: 'SHARED_VAR',
              target: ['production', 'preview', 'development'],
            },
          ],
        })
      )

      const result = await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printInfo).toHaveBeenCalledWith(
        'All shared env vars are configured for production and non-production'
      )
      expect(result).toBe(0)
    })

    it('should detect missing shared vars', async () => {
      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('MISSING_VAR')],
      })
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['MISSING_VAR', 'local-value']]),
        comments: new Map(),
        originalContent: '',
      })
      mockFetch.mockResolvedValue(createFetchResponse({ data: [] }))

      await runDeploy({
        dryRun: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printWarning).toHaveBeenCalledWith(
        'Missing shared env vars in Vercel team: MISSING_VAR'
      )
    })

    it('should detect missing production target', async () => {
      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('SHARED_VAR')],
      })
      mockFetch.mockResolvedValue(
        createFetchResponse({
          data: [
            {
              id: '1',
              key: 'SHARED_VAR',
              target: ['preview', 'development'],
            },
          ],
        })
      )

      await runDeploy({
        dryRun: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printWarning).toHaveBeenCalledWith(
        'Shared env vars missing required targets: SHARED_VAR (missing production target)'
      )
    })

    it('should detect missing non-production target', async () => {
      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('SHARED_VAR')],
      })
      mockFetch.mockResolvedValue(
        createFetchResponse({
          data: [
            {
              id: '1',
              key: 'SHARED_VAR',
              target: ['production'],
            },
          ],
        })
      )

      await runDeploy({
        dryRun: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printWarning).toHaveBeenCalledWith(
        'Shared env vars missing required targets: SHARED_VAR (missing non-production target)'
      )
    })

    it('should handle allCustomEnvs as non-production target', async () => {
      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('SHARED_VAR')],
      })
      mockFetch.mockResolvedValue(
        createFetchResponse({
          data: [
            {
              id: '1',
              key: 'SHARED_VAR',
              target: ['production'],
              includeAllCustomEnvironments: true,
            },
          ],
        })
      )

      const result = await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printInfo).toHaveBeenCalledWith(
        'All shared env vars are configured for production and non-production'
      )
      expect(result).toBe(0)
    })
  })

  describe('API errors', () => {
    it('should handle fetch team shared vars failure', async () => {
      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('VAR1')],
      })
      mockFetch.mockResolvedValue(createFetchResponse({}, false, 401))

      const result = await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printError).toHaveBeenCalledWith(
        'Failed to fetch shared env vars: 401 Error'
      )
      expect(result).toBe(1)
    })

    it('should handle pagination in team shared vars', async () => {
      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('VAR1'), createVarDef('VAR2')],
      })
      mockFetch
        .mockResolvedValueOnce(
          createFetchResponse({
            data: [{ id: '1', key: 'VAR1', target: ['production', 'preview'] }],
            pagination: { next: 12345 },
          })
        )
        .mockResolvedValueOnce(
          createFetchResponse({
            data: [{ id: '2', key: 'VAR2', target: ['production', 'preview'] }],
          })
        )

      const result = await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result).toBe(0)
    })
  })

  describe('project mapping', () => {
    it('should skip app-specific checks when no project mapping', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      mockFetch.mockResolvedValue(createFetchResponse({ data: [] }))

      await runDeploy({
        dryRun: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printWarning).toHaveBeenCalledWith(
        'No project IDs found in deploy-production workflow; skipping app-specific checks'
      )
    })

    it('should parse project mapping from workflow file', async () => {
      const workflowContent = `
        ["web"]="prj_abc123"
        ["api"]="prj_def456"
      `
      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p).includes('deploy-production.yml')
      )
      vi.mocked(fs.readFileSync).mockReturnValue(workflowContent)

      const apps = [createAppInfo('web'), createAppInfo('api')]
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue(apps)
      vi.mocked(parser.parseEnvExample).mockReturnValue({ variables: [] })

      mockFetch.mockResolvedValue(createFetchResponse({ data: [] }))

      await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      // Should have fetched team vars and project vars for each app
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('app-specific vars', () => {
    it('should check app-specific env vars', async () => {
      const workflowContent = '["web"]="prj_abc123"'
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p).includes('deploy-production.yml')) return true
        if (String(p).includes('.env.local')) return true
        return false
      })
      vi.mocked(fs.readFileSync).mockReturnValue(workflowContent)

      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [] }) // root schema
        .mockReturnValueOnce({ variables: [createVarDef('APP_VAR')] }) // app schema
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['APP_VAR', 'value']]),
        comments: new Map(),
        originalContent: '',
      })

      mockFetch
        .mockResolvedValueOnce(createFetchResponse({ data: [] })) // team vars
        .mockResolvedValueOnce(
          createFetchResponse({
            envs: [{ id: '1', key: 'APP_VAR', target: ['production', 'preview'] }],
          })
        ) // project vars

      const result = await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printInfo).toHaveBeenCalledWith(
        '✅ web: app-specific env vars configured for production and non-production'
      )
      expect(result).toBe(0)
    })

    it('should detect missing app-specific vars', async () => {
      const workflowContent = '["web"]="prj_abc123"'
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p).includes('deploy-production.yml')) return true
        if (String(p).includes('.env.local')) return true
        return false
      })
      vi.mocked(fs.readFileSync).mockReturnValue(workflowContent)

      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [] })
        .mockReturnValueOnce({ variables: [createVarDef('MISSING_APP_VAR')] })
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['MISSING_APP_VAR', 'local-value']]),
        comments: new Map(),
        originalContent: '',
      })

      mockFetch
        .mockResolvedValueOnce(createFetchResponse({ data: [] }))
        .mockResolvedValueOnce(createFetchResponse({ envs: [] }))

      await runDeploy({
        dryRun: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printWarning).toHaveBeenCalledWith('App-specific env var issues:')
    })

    it('should handle project env vars fetch failure', async () => {
      const workflowContent = '["web"]="prj_abc123"'
      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p).includes('deploy-production.yml')
      )
      vi.mocked(fs.readFileSync).mockReturnValue(workflowContent)

      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [] })
        .mockReturnValueOnce({ variables: [createVarDef('APP_VAR')] })

      mockFetch
        .mockResolvedValueOnce(createFetchResponse({ data: [] }))
        .mockResolvedValueOnce(createFetchResponse({}, false, 404))

      await runDeploy({
        dryRun: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printWarning).toHaveBeenCalledWith('App-specific env var issues:')
    })
  })

  describe('fatal errors', () => {
    it('should fail when missing var has no local value', async () => {
      // Need workflow file to exist for full path execution
      const workflowContent = '["web"]="prj_abc123"'
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p).includes('deploy-production.yml')) return true
        return false // .env.local files don't exist
      })
      vi.mocked(fs.readFileSync).mockReturnValue(workflowContent)

      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('MISSING_VAR')],
      })
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
      mockFetch.mockResolvedValue(createFetchResponse({ data: [] }))

      const result = await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printError).toHaveBeenCalledWith(
        'Cannot proceed: some missing env vars have no local value. Run "pnpm env-vars-doctor" first.'
      )
      expect(result).toBe(1)
    })
  })

  describe('dry run mode', () => {
    it('should not apply changes in dry run mode', async () => {
      // Need workflow file for full path execution
      const workflowContent = '["web"]="prj_abc123"'
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p).includes('deploy-production.yml')) return true
        if (String(p).includes('.env.local')) return true
        return false
      })
      vi.mocked(fs.readFileSync).mockReturnValue(workflowContent)

      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('MISSING_VAR')],
      })
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['MISSING_VAR', 'value']]),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
      mockFetch.mockResolvedValue(createFetchResponse({ data: [] }))

      const result = await runDeploy({
        dryRun: true,
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printInfo).toHaveBeenCalledWith('Dry run mode - no changes applied.')
      expect(result).toBe(0)
    })
  })

  describe('user confirmation', () => {
    it('should not apply changes when user declines', async () => {
      // Need workflow file for full path execution
      const workflowContent = '["web"]="prj_abc123"'
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p).includes('deploy-production.yml')) return true
        if (String(p).includes('.env.local')) return true
        return false
      })
      vi.mocked(fs.readFileSync).mockReturnValue(workflowContent)

      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('MISSING_VAR')],
      })
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['MISSING_VAR', 'value']]),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
      mockFetch.mockResolvedValue(createFetchResponse({ data: [] }))

      mockQuestion.mockImplementation((_q: string, cb: (answer: string) => void) => cb('n'))

      const result = await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printInfo).toHaveBeenCalledWith(
        'No changes were made (confirmation declined).'
      )
      expect(result).toBe(0)
    })

    it('should apply changes when user confirms', async () => {
      // Need workflow file for full path execution
      const workflowContent = '["web"]="prj_abc123"'
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p).includes('deploy-production.yml')) return true
        if (String(p).includes('.env.local')) return true
        return false
      })
      vi.mocked(fs.readFileSync).mockReturnValue(workflowContent)

      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('MISSING_VAR')],
      })
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['MISSING_VAR', 'value']]),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])

      // First call: fetch team vars (returns empty)
      // Subsequent calls: create shared var API calls
      mockFetch
        .mockResolvedValueOnce(createFetchResponse({ data: [] })) // fetch team vars
        .mockResolvedValue(createFetchResponse({ id: 'new-id' })) // POST calls

      mockQuestion.mockImplementation((_q: string, cb: (answer: string) => void) => {
        // First question is confirmation, then prompts for production values
        cb('y')
      })

      const result = await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printInfo).toHaveBeenCalledWith('Changes applied successfully.')
      expect(result).toBe(0)
    })

    it('should handle API error during apply', async () => {
      // Need workflow file for full path execution
      const workflowContent = '["web"]="prj_abc123"'
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p).includes('deploy-production.yml')) return true
        if (String(p).includes('.env.local')) return true
        return false
      })
      vi.mocked(fs.readFileSync).mockReturnValue(workflowContent)

      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('MISSING_VAR')],
      })
      vi.mocked(parser.parseEnvLocal).mockReturnValue({
        values: new Map([['MISSING_VAR', 'value']]),
        comments: new Map(),
        originalContent: '',
      })
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])

      mockFetch
        .mockResolvedValueOnce(createFetchResponse({ data: [] })) // fetch team vars
        .mockResolvedValue(createFetchResponse({}, false, 500)) // POST fails

      mockQuestion.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'))

      const result = await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printError).toHaveBeenCalled()
      expect(result).toBe(1)
    })
  })

  describe('target handling', () => {
    it('should handle target as string instead of array', async () => {
      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('SHARED_VAR')],
      })
      mockFetch.mockResolvedValue(
        createFetchResponse({
          data: [
            {
              id: '1',
              key: 'SHARED_VAR',
              target: 'production', // string instead of array
              includeAllEnvironments: true,
            },
          ],
        })
      )

      const result = await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(result).toBe(0)
    })

    it('should merge targets from duplicate keys', async () => {
      vi.mocked(parser.parseEnvExample).mockReturnValue({
        variables: [createVarDef('SHARED_VAR')],
      })
      mockFetch.mockResolvedValue(
        createFetchResponse({
          data: [
            { id: '1', key: 'SHARED_VAR', target: ['production'] },
            { id: '2', key: 'SHARED_VAR', target: ['preview', 'development'] },
          ],
        })
      )

      const result = await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(result).toBe(0)
    })
  })

  describe('project env vars API formats', () => {
    it('should handle envs array format', async () => {
      const workflowContent = '["web"]="prj_abc123"'
      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p).includes('deploy-production.yml')
      )
      vi.mocked(fs.readFileSync).mockReturnValue(workflowContent)

      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [] })
        .mockReturnValueOnce({ variables: [createVarDef('APP_VAR')] })

      mockFetch
        .mockResolvedValueOnce(createFetchResponse({ data: [] }))
        .mockResolvedValueOnce(
          createFetchResponse({
            envs: [{ id: '1', key: 'APP_VAR', target: ['production', 'preview'] }],
          })
        )

      await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should handle environmentVariables array format', async () => {
      const workflowContent = '["web"]="prj_abc123"'
      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p).includes('deploy-production.yml')
      )
      vi.mocked(fs.readFileSync).mockReturnValue(workflowContent)

      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [] })
        .mockReturnValueOnce({ variables: [createVarDef('APP_VAR')] })

      mockFetch
        .mockResolvedValueOnce(createFetchResponse({ data: [] }))
        .mockResolvedValueOnce(
          createFetchResponse({
            environmentVariables: [
              { id: '1', name: 'APP_VAR', target: ['production', 'preview'] },
            ],
          })
        )

      await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('no apps with project IDs', () => {
    it('should warn when no apps have project IDs', async () => {
      const workflowContent = '["nonexistent"]="prj_abc123"'
      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p).includes('deploy-production.yml')
      )
      vi.mocked(fs.readFileSync).mockReturnValue(workflowContent)
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([createAppInfo('web')])
      mockFetch.mockResolvedValue(createFetchResponse({ data: [] }))

      await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printWarning).toHaveBeenCalledWith(
        'No apps with project IDs found; skipping app-specific checks'
      )
    })
  })

  describe('all configured message', () => {
    it('should print all configured when no issues', async () => {
      // Need workflow file for full path execution
      const workflowContent = '["web"]="prj_abc123"'
      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p).includes('deploy-production.yml')
      )
      vi.mocked(fs.readFileSync).mockReturnValue(workflowContent)

      // No shared vars, but web app with vars all configured
      const app = createAppInfo('web')
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([app])
      vi.mocked(parser.parseEnvExample)
        .mockReturnValueOnce({ variables: [] }) // root
        .mockReturnValueOnce({ variables: [createVarDef('APP_VAR')] }) // app

      mockFetch
        .mockResolvedValueOnce(createFetchResponse({ data: [] })) // team vars
        .mockResolvedValueOnce(
          createFetchResponse({
            envs: [{ id: '1', key: 'APP_VAR', target: ['production', 'preview'] }],
          })
        ) // project vars

      const result = await runDeploy({
        rootDir: '/project',
        config: createDefaultConfig(),
      })

      expect(reporter.printInfo).toHaveBeenCalledWith(
        'All shared and app-specific env vars are configured for production and non-production'
      )
      expect(result).toBe(0)
    })
  })
})
