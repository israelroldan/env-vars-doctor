import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { EnvDoctorPlugin, EnvDoctorConfig } from '@/core/types.js'

// Mock the registry module
vi.mock('@/plugins/registry.js', () => ({
  registerPlugin: vi.fn(),
  clearRegistry: vi.fn(),
  getValueSources: vi.fn(() => []),
}))

// Mock the sources index
vi.mock('@/sources/index.js', () => ({
  registerPluginSources: vi.fn(),
}))

// Mock the builtin plugins
vi.mock('@/builtin-plugins/supabase/index.js', () => ({
  createSupabasePlugin: vi.fn((config) => ({
    meta: { name: 'supabase', version: '1.0.0', description: 'Supabase plugin' },
    config,
  })),
}))

vi.mock('@/builtin-plugins/vercel/index.js', () => ({
  createVercelPlugin: vi.fn((config) => ({
    meta: { name: 'vercel', version: '1.0.0', description: 'Vercel plugin' },
    config,
  })),
}))

import { loadPlugins, createPlugin } from '@/plugins/loader.js'
import { registerPlugin, clearRegistry, getValueSources } from '@/plugins/registry.js'
import { registerPluginSources } from '@/sources/index.js'
import { createSupabasePlugin } from '@/builtin-plugins/supabase/index.js'
import { createVercelPlugin } from '@/builtin-plugins/vercel/index.js'

describe('loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loadPlugins', () => {
    it('should clear registry before loading plugins', async () => {
      await loadPlugins({})

      expect(clearRegistry).toHaveBeenCalled()
    })

    it('should register plugin sources after loading', async () => {
      await loadPlugins({})

      expect(registerPluginSources).toHaveBeenCalledWith([])
    })

    it('should not load supabase plugin when not enabled', async () => {
      await loadPlugins({
        plugins: {
          supabase: { enabled: false },
        },
      })

      expect(createSupabasePlugin).not.toHaveBeenCalled()
    })

    it('should load supabase plugin when enabled', async () => {
      const config: EnvDoctorConfig = {
        plugins: {
          supabase: { enabled: true },
        },
      }

      const plugins = await loadPlugins(config)

      expect(createSupabasePlugin).toHaveBeenCalledWith({ enabled: true })
      expect(registerPlugin).toHaveBeenCalled()
      expect(plugins).toHaveLength(1)
      expect(plugins[0].meta.name).toBe('supabase')
    })

    it('should not load vercel plugin when not enabled', async () => {
      await loadPlugins({
        plugins: {
          vercel: { enabled: false },
        },
      })

      expect(createVercelPlugin).not.toHaveBeenCalled()
    })

    it('should load vercel plugin when enabled', async () => {
      const config: EnvDoctorConfig = {
        plugins: {
          vercel: { enabled: true },
        },
      }

      const plugins = await loadPlugins(config)

      expect(createVercelPlugin).toHaveBeenCalledWith({ enabled: true })
      expect(registerPlugin).toHaveBeenCalled()
      expect(plugins).toHaveLength(1)
      expect(plugins[0].meta.name).toBe('vercel')
    })

    it('should load multiple bundled plugins', async () => {
      const config: EnvDoctorConfig = {
        plugins: {
          supabase: { enabled: true },
          vercel: { enabled: true },
        },
      }

      const plugins = await loadPlugins(config)

      expect(createSupabasePlugin).toHaveBeenCalled()
      expect(createVercelPlugin).toHaveBeenCalled()
      expect(plugins).toHaveLength(2)
    })

    it('should handle empty plugins config', async () => {
      const plugins = await loadPlugins({})

      expect(plugins).toHaveLength(0)
      expect(createSupabasePlugin).not.toHaveBeenCalled()
      expect(createVercelPlugin).not.toHaveBeenCalled()
    })

    it('should handle undefined plugins config', async () => {
      const config: EnvDoctorConfig = {}

      const plugins = await loadPlugins(config)

      expect(plugins).toHaveLength(0)
    })
  })

  describe('loadPlugins with external plugins', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleWarnSpy.mockRestore()
    })

    it('should warn when external plugin fails to load', async () => {
      const config: EnvDoctorConfig = {
        plugins: {
          external: [{ name: 'non-existent-plugin' }],
        },
      }

      const plugins = await loadPlugins(config)

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load external plugin')
      )
      expect(plugins).toHaveLength(0)
    })

    it('should continue loading other plugins if one fails', async () => {
      const config: EnvDoctorConfig = {
        plugins: {
          supabase: { enabled: true },
          external: [{ name: 'non-existent-plugin' }],
        },
      }

      const plugins = await loadPlugins(config)

      // Supabase should still load even though external failed
      expect(plugins).toHaveLength(1)
      expect(plugins[0].meta.name).toBe('supabase')
      expect(consoleWarnSpy).toHaveBeenCalled()
    })

    it('should handle Error objects in catch block', async () => {
      const config: EnvDoctorConfig = {
        plugins: {
          external: [{ name: 'throws-error-plugin' }],
        },
      }

      await loadPlugins(config)

      // The error message should be included in the warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Failed to load external plugin.*throws-error-plugin/)
      )
    })
  })

  describe('createPlugin', () => {
    it('should create a plugin with meta and options', () => {
      const plugin = createPlugin(
        {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'A test plugin',
        },
        {
          sources: [],
          ignoreMissing: ['TEST_VAR'],
        }
      )

      expect(plugin.meta.name).toBe('test-plugin')
      expect(plugin.meta.version).toBe('1.0.0')
      expect(plugin.meta.description).toBe('A test plugin')
      expect(plugin.sources).toEqual([])
      expect(plugin.ignoreMissing).toEqual(['TEST_VAR'])
    })

    it('should create plugin with all options', () => {
      const hooks = {
        onInit: vi.fn(),
        beforeSync: vi.fn(),
        afterSync: vi.fn(),
      }

      const plugin = createPlugin(
        {
          name: 'full-plugin',
          version: '2.0.0',
          description: 'Full plugin',
        },
        {
          sources: [
            {
              directiveType: 'custom',
              pattern: /\[custom\]/,
              resolve: vi.fn(),
            },
          ],
          deploymentProviders: [
            {
              name: 'custom-deploy',
              getTargets: vi.fn().mockResolvedValue([]),
              deploy: vi.fn(),
            },
          ],
          commands: [
            {
              name: 'custom-cmd',
              description: 'Custom command',
              handler: vi.fn(),
            },
          ],
          hooks,
          ignoreMissing: ['VAR1', 'VAR2'],
        }
      )

      expect(plugin.sources).toHaveLength(1)
      expect(plugin.deploymentProviders).toHaveLength(1)
      expect(plugin.commands).toHaveLength(1)
      expect(plugin.hooks).toBe(hooks)
      expect(plugin.ignoreMissing).toEqual(['VAR1', 'VAR2'])
    })
  })
})
