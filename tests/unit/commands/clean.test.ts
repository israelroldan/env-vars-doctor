import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import { runClean } from '@/commands/clean.js'
import type { AppInfo } from '@/core/types.js'

// Mock all dependencies
vi.mock('node:fs')
vi.mock('@/core/scanner.js')
vi.mock('@/sources/prompt.js')
vi.mock('@/core/reporter.js')

import * as scanner from '@/core/scanner.js'
import * as prompt from '@/sources/prompt.js'
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

describe('clean command', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(scanner.hasEnvLocal).mockReturnValue(true)
    vi.mocked(scanner.getRootEnvPaths).mockReturnValue({
      examplePath: '/project/.env.example',
      localPath: '/project/.env.local',
    })
    vi.mocked(fs.existsSync).mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('app discovery', () => {
    it('should find specific app when --app is provided', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(prompt.confirm).mockResolvedValue(true)

      await runClean({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(scanner.findWorkspace).toHaveBeenCalledWith('web', {}, '/project')
    })

    it('should return 1 when app not found', async () => {
      vi.mocked(scanner.findWorkspace).mockResolvedValue(null)

      const result = await runClean({
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
      vi.mocked(prompt.confirm).mockResolvedValue(true)

      await runClean({
        all: true,
        rootDir: '/project',
        config: {},
      })

      expect(scanner.scanWorkspaces).toHaveBeenCalled()
    })

    it('should return 0 when no files to clean', async () => {
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
      vi.mocked(scanner.detectCurrentWorkspace).mockResolvedValue(null)
      vi.mocked(scanner.hasEnvLocal).mockReturnValue(false)
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = await runClean({
        all: true,
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printInfo).toHaveBeenCalledWith('No .env.local files found to clean.')
      expect(result).toBe(0)
    })
  })

  describe('confirmation', () => {
    it('should prompt for confirmation when not forced', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(prompt.confirm).mockResolvedValue(true)

      await runClean({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(prompt.confirm).toHaveBeenCalledWith('Delete 1 .env.local file(s)?', false)
    })

    it('should count root env.local in confirmation', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(fs.existsSync).mockReturnValue(true) // Root .env.local exists
      vi.mocked(prompt.confirm).mockResolvedValue(true)

      await runClean({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(prompt.confirm).toHaveBeenCalledWith('Delete 2 .env.local file(s)?', false)
    })

    it('should cancel when user declines', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(prompt.confirm).mockResolvedValue(false)

      const result = await runClean({
        app: 'web',
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printInfo).toHaveBeenCalledWith('Cancelled.')
      expect(fs.unlinkSync).not.toHaveBeenCalled()
      expect(result).toBe(0)
    })

    it('should skip confirmation when --force is provided', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)

      await runClean({
        app: 'web',
        force: true,
        rootDir: '/project',
        config: {},
      })

      expect(prompt.confirm).not.toHaveBeenCalled()
      expect(fs.unlinkSync).toHaveBeenCalled()
    })
  })

  describe('deletion', () => {
    it('should delete root env.local when it exists', async () => {
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue([])
      vi.mocked(scanner.detectCurrentWorkspace).mockResolvedValue(null)
      vi.mocked(scanner.hasEnvLocal).mockReturnValue(false)
      vi.mocked(fs.existsSync).mockReturnValue(true) // Root .env.local exists

      await runClean({
        all: true,
        force: true,
        rootDir: '/project',
        config: {},
      })

      expect(fs.unlinkSync).toHaveBeenCalledWith('/project/.env.local')
    })

    it('should delete app env.local files', async () => {
      const apps = [createAppInfo('web'), createAppInfo('api')]
      vi.mocked(scanner.scanWorkspaces).mockResolvedValue(apps)

      await runClean({
        all: true,
        force: true,
        rootDir: '/project',
        config: {},
      })

      expect(fs.unlinkSync).toHaveBeenCalledWith('/apps/web/.env.local')
      expect(fs.unlinkSync).toHaveBeenCalledWith('/apps/api/.env.local')
    })

    it('should report deleted file count', async () => {
      const app = createAppInfo('web')
      vi.mocked(scanner.findWorkspace).mockResolvedValue(app)
      vi.mocked(fs.existsSync).mockReturnValue(true) // Root exists too

      await runClean({
        app: 'web',
        force: true,
        rootDir: '/project',
        config: {},
      })

      expect(reporter.printInfo).toHaveBeenCalledWith('Deleted 2 file(s).')
    })
  })
})
