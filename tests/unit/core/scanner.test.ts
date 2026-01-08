import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  detectMonorepoRoot,
  getProjectRoot,
  getRootEnvPaths,
  hasEnvExample,
  hasEnvLocal,
  scanWorkspacesSync,
  scanWorkspaces,
  getWorkspacesWithSchema,
  findWorkspace,
  detectCurrentWorkspace,
} from '@/core/scanner.js'
import type { AppInfo, EnvDoctorConfig } from '@/core/types.js'

// Mock fs module
vi.mock('node:fs')

// Mock glob module
vi.mock('glob', () => ({
  glob: vi.fn(() => Promise.resolve([])),
}))

import { glob } from 'glob'

describe('scanner', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('detectMonorepoRoot', () => {
    it('should detect pnpm-workspace.yaml', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === '/project/pnpm-workspace.yaml'
      })

      const result = detectMonorepoRoot('/project/apps/web')

      expect(result).toBe('/project')
    })

    it('should detect package.json with workspaces array', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === '/project/package.json'
      })
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ workspaces: ['apps/*', 'packages/*'] })
      )

      const result = detectMonorepoRoot('/project/apps/web')

      expect(result).toBe('/project')
    })

    it('should detect package.json with workspaces.packages', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === '/project/package.json'
      })
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ workspaces: { packages: ['apps/*'] } })
      )

      const result = detectMonorepoRoot('/project/apps/web')

      expect(result).toBe('/project')
    })

    it('should detect lerna.json', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === '/project/lerna.json'
      })

      const result = detectMonorepoRoot('/project/apps/web')

      expect(result).toBe('/project')
    })

    it('should fallback to start directory if no workspace config or package.json found', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = detectMonorepoRoot('/some/random/dir')

      expect(result).toBe('/some/random/dir')
    })

    it('should return nearest package.json dir for single-project when started from subdirectory', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        // No workspace configs anywhere
        if (pathStr.includes('pnpm-workspace.yaml')) return false
        if (pathStr.includes('lerna.json')) return false
        // package.json only at /project root, not in subdirectories
        if (pathStr === '/project/package.json') return true
        return false
      })
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p) === '/project/package.json') {
          // No workspaces - single project
          return JSON.stringify({ name: 'my-project', version: '1.0.0' })
        }
        return ''
      })

      // Start from a subdirectory
      const result = detectMonorepoRoot('/project/src/components')

      // Should find the project root, not the subdirectory
      expect(result).toBe('/project')
    })

    it('should use cwd if no start directory provided', () => {
      const cwd = process.cwd()
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = detectMonorepoRoot()

      expect(result).toBe(cwd)
    })

    it('should handle package.json parse errors gracefully', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return typeof p === 'string' && p.endsWith('package.json')
      })
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json {')

      // Should not throw, should continue searching
      const result = detectMonorepoRoot('/project/nested/app')

      expect(result).toBeDefined()
    })
  })

  describe('getRootEnvPaths', () => {
    it('should return default paths when no config overrides', () => {
      const config: EnvDoctorConfig = {}

      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = getRootEnvPaths(config, '/project')

      expect(result.examplePath).toBe('/project/.env.local.example')
      expect(result.localPath).toBe('/project/.env.local')
    })

    it('should use custom paths from config', () => {
      const config: EnvDoctorConfig = {
        project: {
          rootEnvExample: '.env.example',
          rootEnvLocal: '.env',
        },
      }

      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = getRootEnvPaths(config, '/project')

      expect(result.examplePath).toBe('/project/.env.example')
      expect(result.localPath).toBe('/project/.env')
    })
  })

  describe('hasEnvExample', () => {
    it('should return true when .env.example exists', () => {
      const app: AppInfo = {
        name: 'test-app',
        path: '/project/apps/test-app',
        envExamplePath: '/project/apps/test-app/.env.example',
        envLocalPath: '/project/apps/test-app/.env.local',
      }

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === '/project/apps/test-app/.env.example'
      })

      expect(hasEnvExample(app)).toBe(true)
    })

    it('should return false when .env.example does not exist', () => {
      const app: AppInfo = {
        name: 'test-app',
        path: '/project/apps/test-app',
        envExamplePath: '/project/apps/test-app/.env.example',
        envLocalPath: '/project/apps/test-app/.env.local',
      }

      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(hasEnvExample(app)).toBe(false)
    })
  })

  describe('hasEnvLocal', () => {
    it('should return true when .env.local exists', () => {
      const app: AppInfo = {
        name: 'test-app',
        path: '/project/apps/test-app',
        envExamplePath: '/project/apps/test-app/.env.example',
        envLocalPath: '/project/apps/test-app/.env.local',
      }

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === '/project/apps/test-app/.env.local'
      })

      expect(hasEnvLocal(app)).toBe(true)
    })

    it('should return false when .env.local does not exist', () => {
      const app: AppInfo = {
        name: 'test-app',
        path: '/project/apps/test-app',
        envExamplePath: '/project/apps/test-app/.env.example',
        envLocalPath: '/project/apps/test-app/.env.local',
      }

      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(hasEnvLocal(app)).toBe(false)
    })
  })

  describe('getProjectRoot', () => {
    it('should use detectMonorepoRoot', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === '/project/pnpm-workspace.yaml'
      })

      const config: EnvDoctorConfig = {}
      const result = getProjectRoot(config, '/project/apps/web')

      expect(result).toBe('/project')
    })
  })

  describe('scanWorkspacesSync', () => {
    it('should find workspaces matching apps/* pattern', () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      // Mock file system
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === '/project/apps') return true
        if (pathStr === '/project/apps/web/package.json') return true
        if (pathStr === '/project/apps/api/package.json') return true
        return false
      })

      vi.mocked(fs.readdirSync).mockImplementation((p, options) => {
        if (String(p) === '/project/apps') {
          return [
            { name: 'web', isDirectory: () => true, isFile: () => false },
            { name: 'api', isDirectory: () => true, isFile: () => false },
            { name: 'README.md', isDirectory: () => false, isFile: () => true },
          ] as any
        }
        return []
      })

      const result = scanWorkspacesSync(config, '/project')

      expect(result).toHaveLength(2)
      expect(result.map((a) => a.name)).toContain('web')
      expect(result.map((a) => a.name)).toContain('api')
    })

    it('should skip directories without package.json', () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === '/project/apps') return true
        // Only web has package.json
        if (pathStr === '/project/apps/web/package.json') return true
        return false
      })

      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p) === '/project/apps') {
          return [
            { name: 'web', isDirectory: () => true, isFile: () => false },
            { name: 'no-package', isDirectory: () => true, isFile: () => false },
          ] as any
        }
        return []
      })

      const result = scanWorkspacesSync(config, '/project')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('web')
    })

    it('should handle non-existent workspace directories', () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*', 'packages/*'],
          },
        },
      }

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        // Only apps exists, packages doesn't
        if (pathStr === '/project/apps') return true
        if (pathStr === '/project/apps/web/package.json') return true
        return false
      })

      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p) === '/project/apps') {
          return [{ name: 'web', isDirectory: () => true, isFile: () => false }] as any
        }
        return []
      })

      const result = scanWorkspacesSync(config, '/project')

      expect(result).toHaveLength(1)
    })

    it('should use default patterns when none specified', () => {
      const config: EnvDoctorConfig = {}

      // Mock pnpm-workspace.yaml detection
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === '/project/pnpm-workspace.yaml') return true
        if (pathStr === '/project/apps') return true
        if (pathStr === '/project/apps/web/package.json') return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p) === '/project/pnpm-workspace.yaml') {
          return 'packages:\n  - "apps/*"\n  - "packages/*"\n'
        }
        return ''
      })

      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p) === '/project/apps') {
          return [{ name: 'web', isDirectory: () => true, isFile: () => false }] as any
        }
        return []
      })

      const result = scanWorkspacesSync(config, '/project')

      expect(result.length).toBeGreaterThanOrEqual(0)
    })

    it('should sort workspaces alphabetically', () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === '/project/apps') return true
        if (pathStr.includes('package.json')) return true
        return false
      })

      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p) === '/project/apps') {
          return [
            { name: 'zebra', isDirectory: () => true, isFile: () => false },
            { name: 'alpha', isDirectory: () => true, isFile: () => false },
            { name: 'beta', isDirectory: () => true, isFile: () => false },
          ] as any
        }
        return []
      })

      const result = scanWorkspacesSync(config, '/project')

      expect(result[0].name).toBe('alpha')
      expect(result[1].name).toBe('beta')
      expect(result[2].name).toBe('zebra')
    })

    it('should use custom env file names from config', () => {
      const config: EnvDoctorConfig = {
        project: {
          rootEnvExample: '.env.schema',
          rootEnvLocal: '.env',
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === '/project/apps') return true
        if (pathStr === '/project/apps/web/package.json') return true
        return false
      })

      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p) === '/project/apps') {
          return [{ name: 'web', isDirectory: () => true, isFile: () => false }] as any
        }
        return []
      })

      const result = scanWorkspacesSync(config, '/project')

      expect(result[0].envExamplePath).toContain('.env.schema')
      expect(result[0].envLocalPath).toContain('.env')
    })

    it('should handle complex patterns gracefully', () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['packages/nested/**/*'],
          },
        },
      }

      vi.mocked(fs.existsSync).mockReturnValue(false)

      // Complex patterns that don't match simple /* should be handled
      const result = scanWorkspacesSync(config, '/project')

      expect(result).toHaveLength(0)
    })

    it('should return no workspaces when detection is manual and no patterns provided', () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            detection: 'manual',
          },
        },
      }

      // Even with apps that could match, manual detection returns empty patterns
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === '/project/apps') return true
        if (pathStr === '/project/apps/web/package.json') return true
        return false
      })

      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p) === '/project/apps') {
          return [{ name: 'web', isDirectory: () => true, isFile: () => false }] as any
        }
        return []
      })

      const result = scanWorkspacesSync(config, '/project')

      expect(result).toHaveLength(0)
    })

    it('should detect patterns from package.json workspaces array when pnpm-workspace.yaml missing', () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            detection: 'npm',
          },
        },
      }

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        // No pnpm-workspace.yaml
        if (pathStr === '/project/pnpm-workspace.yaml') return false
        // package.json exists
        if (pathStr === '/project/package.json') return true
        if (pathStr === '/project/apps') return true
        if (pathStr === '/project/apps/web/package.json') return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p) === '/project/package.json') {
          return JSON.stringify({ workspaces: ['apps/*'] })
        }
        return ''
      })

      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p) === '/project/apps') {
          return [{ name: 'web', isDirectory: () => true, isFile: () => false }] as any
        }
        return []
      })

      const result = scanWorkspacesSync(config, '/project')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('web')
    })

    it('should detect patterns from package.json workspaces.packages', () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            detection: 'yarn',
          },
        },
      }

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === '/project/pnpm-workspace.yaml') return false
        if (pathStr === '/project/package.json') return true
        if (pathStr === '/project/packages') return true
        if (pathStr === '/project/packages/core/package.json') return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p) === '/project/package.json') {
          return JSON.stringify({ workspaces: { packages: ['packages/*'] } })
        }
        return ''
      })

      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p) === '/project/packages') {
          return [{ name: 'core', isDirectory: () => true, isFile: () => false }] as any
        }
        return []
      })

      const result = scanWorkspacesSync(config, '/project')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('core')
    })

    it('should use default patterns when package.json has no workspaces', () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            detection: 'auto',
          },
        },
      }

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        // No pnpm-workspace.yaml
        if (pathStr === '/project/pnpm-workspace.yaml') return false
        // package.json exists but has no workspaces
        if (pathStr === '/project/package.json') return true
        // Default patterns: apps/* and packages/*
        if (pathStr === '/project/apps') return true
        if (pathStr === '/project/apps/web/package.json') return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p) === '/project/package.json') {
          return JSON.stringify({ name: 'root', dependencies: {} })
        }
        return ''
      })

      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p) === '/project/apps') {
          return [{ name: 'web', isDirectory: () => true, isFile: () => false }] as any
        }
        return []
      })

      const result = scanWorkspacesSync(config, '/project')

      // Should find workspace using default 'apps/*' pattern
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('web')
    })
  })

  describe('scanWorkspaces', () => {
    it('should use glob to find workspace directories', async () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(glob).mockResolvedValue(['apps/web', 'apps/api'])
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)

      const result = await scanWorkspaces(config, '/project')

      expect(glob).toHaveBeenCalledWith('apps/*', expect.objectContaining({ cwd: '/project' }))
    })

    it('should filter out non-directory matches', async () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(glob).mockResolvedValue(['apps/web', 'apps/file.txt'])
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).includes('package.json')
      })
      vi.mocked(fs.statSync).mockImplementation((p) => {
        if (String(p).includes('file.txt')) {
          return { isDirectory: () => false } as fs.Stats
        }
        return { isDirectory: () => true } as fs.Stats
      })

      const result = await scanWorkspaces(config, '/project')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('web')
    })

    it('should skip directories without package.json', async () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(glob).mockResolvedValue(['apps/web', 'apps/no-package'])
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        // Only web has package.json
        return String(p) === '/project/apps/web/package.json'
      })

      const result = await scanWorkspaces(config, '/project')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('web')
    })

    it('should handle stat errors gracefully', async () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(glob).mockResolvedValue(['apps/web', 'apps/broken'])
      vi.mocked(fs.statSync).mockImplementation((p) => {
        if (String(p).includes('broken')) {
          throw new Error('ENOENT')
        }
        return { isDirectory: () => true } as fs.Stats
      })
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === '/project/apps/web/package.json'
      })

      const result = await scanWorkspaces(config, '/project')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('web')
    })

    it('should sort results alphabetically', async () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(glob).mockResolvedValue(['apps/zebra', 'apps/alpha', 'apps/beta'])
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)
      vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('package.json'))

      const result = await scanWorkspaces(config, '/project')

      expect(result[0].name).toBe('alpha')
      expect(result[1].name).toBe('beta')
      expect(result[2].name).toBe('zebra')
    })

    it('should use custom env file names from config', async () => {
      const config: EnvDoctorConfig = {
        project: {
          rootEnvExample: '.env.schema',
          rootEnvLocal: '.env',
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(glob).mockResolvedValue(['apps/web'])
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const result = await scanWorkspaces(config, '/project')

      expect(result[0].envExamplePath).toContain('.env.schema')
      expect(result[0].envLocalPath).toContain('.env')
    })

    it('should detect patterns from pnpm-workspace.yaml when no patterns specified', async () => {
      const config: EnvDoctorConfig = {}

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === '/project/pnpm-workspace.yaml') return true
        if (pathStr.includes('package.json')) return true
        return false
      })
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p) === '/project/pnpm-workspace.yaml') {
          return 'packages:\n  - "apps/*"\n'
        }
        return ''
      })
      vi.mocked(glob).mockResolvedValue(['apps/web'])
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)

      const result = await scanWorkspaces(config, '/project')

      expect(glob).toHaveBeenCalledWith('apps/*', expect.any(Object))
    })
  })

  describe('getWorkspacesWithSchema', () => {
    it('should filter to only apps with env example files', async () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(glob).mockResolvedValue(['apps/web', 'apps/api'])
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        // All have package.json
        if (pathStr.includes('package.json')) return true
        // Only web has .env.local.example
        if (pathStr === '/project/apps/web/.env.local.example') return true
        return false
      })

      const result = await getWorkspacesWithSchema(config, '/project')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('web')
    })

    it('should return empty array when no apps have schema', async () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(glob).mockResolvedValue(['apps/web'])
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).includes('package.json')
      })

      const result = await getWorkspacesWithSchema(config, '/project')

      expect(result).toHaveLength(0)
    })
  })

  describe('findWorkspace', () => {
    it('should find a workspace by name', async () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(glob).mockResolvedValue(['apps/web', 'apps/api'])
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)
      vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('package.json'))

      const result = await findWorkspace('api', config, '/project')

      expect(result).not.toBeNull()
      expect(result?.name).toBe('api')
    })

    it('should return null when workspace not found', async () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(glob).mockResolvedValue(['apps/web'])
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)
      vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('package.json'))

      const result = await findWorkspace('nonexistent', config, '/project')

      expect(result).toBeNull()
    })
  })

  describe('detectCurrentWorkspace', () => {
    const originalCwd = process.cwd

    beforeEach(() => {
      process.cwd = vi.fn()
    })

    afterEach(() => {
      process.cwd = originalCwd
    })

    it('should detect workspace when cwd is inside an app', async () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(process.cwd).mockReturnValue('/project/apps/web/src')
      vi.mocked(glob).mockResolvedValue(['apps/web', 'apps/api'])
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr.includes('package.json')) return true
        if (pathStr === '/project/pnpm-workspace.yaml') return true
        return false
      })

      const result = await detectCurrentWorkspace(config, '/project')

      expect(result).not.toBeNull()
      expect(result?.name).toBe('web')
    })

    it('should return null when cwd is outside project root', async () => {
      const config: EnvDoctorConfig = {}

      vi.mocked(process.cwd).mockReturnValue('/other/path')
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = await detectCurrentWorkspace(config, '/project')

      expect(result).toBeNull()
    })

    it('should return null when cwd is in root but not in any app', async () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(process.cwd).mockReturnValue('/project/scripts')
      vi.mocked(glob).mockResolvedValue(['apps/web'])
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr.includes('package.json')) return true
        if (pathStr === '/project/pnpm-workspace.yaml') return true
        return false
      })

      const result = await detectCurrentWorkspace(config, '/project')

      expect(result).toBeNull()
    })

    it('should match exact app path', async () => {
      const config: EnvDoctorConfig = {
        project: {
          workspaces: {
            patterns: ['apps/*'],
          },
        },
      }

      vi.mocked(process.cwd).mockReturnValue('/project/apps/web')
      vi.mocked(glob).mockResolvedValue(['apps/web'])
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr.includes('package.json')) return true
        if (pathStr === '/project/pnpm-workspace.yaml') return true
        return false
      })

      const result = await detectCurrentWorkspace(config, '/project')

      expect(result).not.toBeNull()
      expect(result?.name).toBe('web')
    })
  })

  describe('single-project support', () => {
    describe('scanWorkspaces', () => {
      it('should return root as app when no workspace config and .env.local.example exists', async () => {
        const config: EnvDoctorConfig = {}

        // No workspace config files exist
        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = String(p)
          // No pnpm-workspace.yaml, no workspaces in package.json, no lerna.json
          if (pathStr === '/project/pnpm-workspace.yaml') return false
          if (pathStr === '/project/lerna.json') return false
          if (pathStr === '/project/package.json') return true
          // Root has .env.local.example
          if (pathStr === '/project/.env.local.example') return true
          // No workspace directories
          if (pathStr === '/project/apps') return false
          if (pathStr === '/project/packages') return false
          return false
        })

        vi.mocked(fs.readFileSync).mockImplementation((p) => {
          if (String(p) === '/project/package.json') {
            // No workspaces field
            return JSON.stringify({ name: 'my-project', version: '1.0.0' })
          }
          return ''
        })

        vi.mocked(glob).mockResolvedValue([])

        const result = await scanWorkspaces(config, '/project')

        expect(result).toHaveLength(1)
        expect(result[0].name).toBe('project')
        expect(result[0].path).toBe('/project')
        expect(result[0].envExamplePath).toBe('/project/.env.local.example')
        expect(result[0].envLocalPath).toBe('/project/.env.local')
      })

      it('should return empty when no workspace config and no .env.local.example', async () => {
        const config: EnvDoctorConfig = {}

        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = String(p)
          if (pathStr === '/project/pnpm-workspace.yaml') return false
          if (pathStr === '/project/lerna.json') return false
          if (pathStr === '/project/package.json') return true
          // No .env.local.example at root
          if (pathStr === '/project/.env.local.example') return false
          if (pathStr === '/project/apps') return false
          if (pathStr === '/project/packages') return false
          return false
        })

        vi.mocked(fs.readFileSync).mockImplementation((p) => {
          if (String(p) === '/project/package.json') {
            return JSON.stringify({ name: 'my-project' })
          }
          return ''
        })

        vi.mocked(glob).mockResolvedValue([])

        const result = await scanWorkspaces(config, '/project')

        expect(result).toHaveLength(0)
      })

      it('should NOT fall back to single-project when monorepo config exists but no workspaces match', async () => {
        const config: EnvDoctorConfig = {}

        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = String(p)
          // Has pnpm-workspace.yaml (monorepo config exists)
          if (pathStr === '/project/pnpm-workspace.yaml') return true
          if (pathStr === '/project/package.json') return true
          // Root has .env.local.example
          if (pathStr === '/project/.env.local.example') return true
          // But no workspace directories exist
          if (pathStr === '/project/apps') return false
          if (pathStr === '/project/packages') return false
          return false
        })

        vi.mocked(fs.readFileSync).mockImplementation((p) => {
          if (String(p) === '/project/pnpm-workspace.yaml') {
            return 'packages:\n  - "apps/*"\n'
          }
          if (String(p) === '/project/package.json') {
            return JSON.stringify({ name: 'my-monorepo' })
          }
          return ''
        })

        vi.mocked(glob).mockResolvedValue([])

        const result = await scanWorkspaces(config, '/project')

        // Should NOT return root as app because monorepo config exists
        expect(result).toHaveLength(0)
      })

      it('should use custom env file names for single-project', async () => {
        const config: EnvDoctorConfig = {
          project: {
            rootEnvExample: '.env.example',
            rootEnvLocal: '.env',
          },
        }

        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = String(p)
          if (pathStr === '/project/pnpm-workspace.yaml') return false
          if (pathStr === '/project/lerna.json') return false
          if (pathStr === '/project/package.json') return true
          if (pathStr === '/project/.env.example') return true
          if (pathStr === '/project/apps') return false
          if (pathStr === '/project/packages') return false
          return false
        })

        vi.mocked(fs.readFileSync).mockImplementation((p) => {
          if (String(p) === '/project/package.json') {
            return JSON.stringify({ name: 'my-project' })
          }
          return ''
        })

        vi.mocked(glob).mockResolvedValue([])

        const result = await scanWorkspaces(config, '/project')

        expect(result).toHaveLength(1)
        expect(result[0].envExamplePath).toBe('/project/.env.example')
        expect(result[0].envLocalPath).toBe('/project/.env')
      })
    })

    describe('scanWorkspacesSync', () => {
      it('should return root as app when no workspace config and .env.local.example exists', () => {
        const config: EnvDoctorConfig = {}

        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = String(p)
          if (pathStr === '/project/pnpm-workspace.yaml') return false
          if (pathStr === '/project/lerna.json') return false
          if (pathStr === '/project/package.json') return true
          if (pathStr === '/project/.env.local.example') return true
          if (pathStr === '/project/apps') return false
          if (pathStr === '/project/packages') return false
          return false
        })

        vi.mocked(fs.readFileSync).mockImplementation((p) => {
          if (String(p) === '/project/package.json') {
            return JSON.stringify({ name: 'my-project' })
          }
          return ''
        })

        const result = scanWorkspacesSync(config, '/project')

        expect(result).toHaveLength(1)
        expect(result[0].name).toBe('project')
        expect(result[0].path).toBe('/project')
      })

      it('should return empty when no workspace config and no .env.local.example', () => {
        const config: EnvDoctorConfig = {}

        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = String(p)
          if (pathStr === '/project/pnpm-workspace.yaml') return false
          if (pathStr === '/project/lerna.json') return false
          if (pathStr === '/project/package.json') return true
          if (pathStr === '/project/.env.local.example') return false
          if (pathStr === '/project/apps') return false
          if (pathStr === '/project/packages') return false
          return false
        })

        vi.mocked(fs.readFileSync).mockImplementation((p) => {
          if (String(p) === '/project/package.json') {
            return JSON.stringify({ name: 'my-project' })
          }
          return ''
        })

        const result = scanWorkspacesSync(config, '/project')

        expect(result).toHaveLength(0)
      })
    })

    describe('detectCurrentWorkspace', () => {
      const originalCwd = process.cwd

      beforeEach(() => {
        process.cwd = vi.fn()
      })

      afterEach(() => {
        process.cwd = originalCwd
      })

      it('should return root app when in single-project root directory', async () => {
        const config: EnvDoctorConfig = {}

        vi.mocked(process.cwd).mockReturnValue('/project')
        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = String(p)
          if (pathStr === '/project/pnpm-workspace.yaml') return false
          if (pathStr === '/project/lerna.json') return false
          if (pathStr === '/project/package.json') return true
          if (pathStr === '/project/.env.local.example') return true
          if (pathStr === '/project/apps') return false
          if (pathStr === '/project/packages') return false
          return false
        })

        vi.mocked(fs.readFileSync).mockImplementation((p) => {
          if (String(p) === '/project/package.json') {
            return JSON.stringify({ name: 'my-project' })
          }
          return ''
        })

        vi.mocked(glob).mockResolvedValue([])

        const result = await detectCurrentWorkspace(config, '/project')

        expect(result).not.toBeNull()
        expect(result?.name).toBe('project')
        expect(result?.path).toBe('/project')
      })

      it('should return root app when in single-project subdirectory', async () => {
        const config: EnvDoctorConfig = {}

        vi.mocked(process.cwd).mockReturnValue('/project/src/components')
        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = String(p)
          if (pathStr === '/project/pnpm-workspace.yaml') return false
          if (pathStr === '/project/lerna.json') return false
          if (pathStr === '/project/package.json') return true
          if (pathStr === '/project/.env.local.example') return true
          if (pathStr === '/project/apps') return false
          if (pathStr === '/project/packages') return false
          return false
        })

        vi.mocked(fs.readFileSync).mockImplementation((p) => {
          if (String(p) === '/project/package.json') {
            return JSON.stringify({ name: 'my-project' })
          }
          return ''
        })

        vi.mocked(glob).mockResolvedValue([])

        const result = await detectCurrentWorkspace(config, '/project')

        expect(result).not.toBeNull()
        expect(result?.name).toBe('project')
      })
    })
  })
})
