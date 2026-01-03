import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  registerPlugin,
  registerPlugins,
  getPlugins,
  getValueSources,
  getDeploymentProviders,
  getCommands,
  getHooks,
  findDeploymentProvider,
  findCommand,
  clearRegistry,
  executeOnInitHooks,
  executeBeforeSyncHooks,
  executeAfterSyncHooks,
  getPluginIgnoreMissing,
} from '@/plugins/registry.js'
import type {
  EnvDoctorPlugin,
  ValueSourceProvider,
  DeploymentProvider,
  CommandProvider,
  PluginHooks,
  AppInfo,
  ReconciliationResult,
} from '@/core/types.js'

// Helper to create a minimal plugin
function createTestPlugin(
  name: string,
  options: Partial<Omit<EnvDoctorPlugin, 'meta'>> = {}
): EnvDoctorPlugin {
  return {
    meta: {
      name,
      version: '1.0.0',
      description: `Test plugin: ${name}`,
    },
    ...options,
  }
}

// Helper to create a value source
function createValueSource(directiveType: string): ValueSourceProvider {
  return {
    directiveType,
    pattern: new RegExp(`\\[${directiveType}\\]`),
    resolve: vi.fn().mockResolvedValue({ value: 'test-value' }),
  }
}

// Helper to create a deployment provider
function createDeploymentProvider(name: string): DeploymentProvider {
  return {
    name,
    getTargets: vi.fn().mockResolvedValue([{ name: 'production', description: 'Production' }]),
    deploy: vi.fn().mockResolvedValue({ success: true, message: 'Deployed' }),
  }
}

// Helper to create a command provider
function createCommandProvider(name: string): CommandProvider {
  return {
    name,
    description: `${name} command`,
    handler: vi.fn().mockResolvedValue(undefined),
  }
}

describe('registry', () => {
  beforeEach(() => {
    clearRegistry()
  })

  describe('registerPlugin', () => {
    it('should register a basic plugin', () => {
      const plugin = createTestPlugin('basic')
      registerPlugin(plugin)

      const plugins = getPlugins()
      expect(plugins).toHaveLength(1)
      expect(plugins[0].meta.name).toBe('basic')
    })

    it('should register plugin with value sources', () => {
      const source = createValueSource('custom')
      const plugin = createTestPlugin('with-sources', {
        sources: [source],
      })

      registerPlugin(plugin)

      const sources = getValueSources()
      expect(sources).toHaveLength(1)
      expect(sources[0].directiveType).toBe('custom')
    })

    it('should register plugin with deployment providers', () => {
      const provider = createDeploymentProvider('aws')
      const plugin = createTestPlugin('with-deploy', {
        deploymentProviders: [provider],
      })

      registerPlugin(plugin)

      const providers = getDeploymentProviders()
      expect(providers).toHaveLength(1)
      expect(providers[0].name).toBe('aws')
    })

    it('should register plugin with commands', () => {
      const command = createCommandProvider('custom-cmd')
      const plugin = createTestPlugin('with-commands', {
        commands: [command],
      })

      registerPlugin(plugin)

      const commands = getCommands()
      expect(commands).toHaveLength(1)
      expect(commands[0].name).toBe('custom-cmd')
    })

    it('should register plugin with hooks', () => {
      const hooks: PluginHooks = {
        onInit: vi.fn(),
        beforeSync: vi.fn(),
        afterSync: vi.fn(),
      }
      const plugin = createTestPlugin('with-hooks', { hooks })

      registerPlugin(plugin)

      const registeredHooks = getHooks()
      expect(registeredHooks).toHaveLength(1)
      expect(registeredHooks[0]).toBe(hooks)
    })

    it('should accumulate multiple plugins', () => {
      registerPlugin(createTestPlugin('plugin1'))
      registerPlugin(createTestPlugin('plugin2'))
      registerPlugin(createTestPlugin('plugin3'))

      expect(getPlugins()).toHaveLength(3)
    })

    it('should accumulate sources from multiple plugins', () => {
      registerPlugin(
        createTestPlugin('plugin1', {
          sources: [createValueSource('source1')],
        })
      )
      registerPlugin(
        createTestPlugin('plugin2', {
          sources: [createValueSource('source2'), createValueSource('source3')],
        })
      )

      expect(getValueSources()).toHaveLength(3)
    })
  })

  describe('registerPlugins', () => {
    it('should register multiple plugins at once', () => {
      const plugins = [
        createTestPlugin('plugin1'),
        createTestPlugin('plugin2'),
        createTestPlugin('plugin3'),
      ]

      registerPlugins(plugins)

      expect(getPlugins()).toHaveLength(3)
    })
  })

  describe('findDeploymentProvider', () => {
    it('should find a deployment provider by name', () => {
      const provider = createDeploymentProvider('vercel')
      registerPlugin(
        createTestPlugin('vercel-plugin', {
          deploymentProviders: [provider],
        })
      )

      const found = findDeploymentProvider('vercel')
      expect(found).toBeDefined()
      expect(found?.name).toBe('vercel')
    })

    it('should return undefined for non-existent provider', () => {
      registerPlugin(
        createTestPlugin('plugin', {
          deploymentProviders: [createDeploymentProvider('aws')],
        })
      )

      const found = findDeploymentProvider('gcp')
      expect(found).toBeUndefined()
    })
  })

  describe('findCommand', () => {
    it('should find a command by name', () => {
      const command = createCommandProvider('deploy')
      registerPlugin(
        createTestPlugin('plugin', {
          commands: [command],
        })
      )

      const found = findCommand('deploy')
      expect(found).toBeDefined()
      expect(found?.name).toBe('deploy')
    })

    it('should return undefined for non-existent command', () => {
      registerPlugin(
        createTestPlugin('plugin', {
          commands: [createCommandProvider('deploy')],
        })
      )

      const found = findCommand('build')
      expect(found).toBeUndefined()
    })
  })

  describe('clearRegistry', () => {
    it('should clear all registered plugins', () => {
      registerPlugin(
        createTestPlugin('plugin', {
          sources: [createValueSource('source')],
          deploymentProviders: [createDeploymentProvider('deploy')],
          commands: [createCommandProvider('cmd')],
          hooks: { onInit: vi.fn() },
        })
      )

      expect(getPlugins()).toHaveLength(1)
      expect(getValueSources()).toHaveLength(1)
      expect(getDeploymentProviders()).toHaveLength(1)
      expect(getCommands()).toHaveLength(1)
      expect(getHooks()).toHaveLength(1)

      clearRegistry()

      expect(getPlugins()).toHaveLength(0)
      expect(getValueSources()).toHaveLength(0)
      expect(getDeploymentProviders()).toHaveLength(0)
      expect(getCommands()).toHaveLength(0)
      expect(getHooks()).toHaveLength(0)
    })
  })

  describe('executeOnInitHooks', () => {
    it('should execute all onInit hooks', async () => {
      const onInit1 = vi.fn()
      const onInit2 = vi.fn()

      registerPlugin(createTestPlugin('plugin1', { hooks: { onInit: onInit1 } }))
      registerPlugin(createTestPlugin('plugin2', { hooks: { onInit: onInit2 } }))

      const config = { version: '1' as const }
      await executeOnInitHooks(config)

      expect(onInit1).toHaveBeenCalledWith(config)
      expect(onInit2).toHaveBeenCalledWith(config)
    })

    it('should skip plugins without onInit hook', async () => {
      const onInit = vi.fn()

      registerPlugin(createTestPlugin('plugin1', { hooks: { onInit } }))
      registerPlugin(createTestPlugin('plugin2', { hooks: {} }))

      await executeOnInitHooks({})

      expect(onInit).toHaveBeenCalledTimes(1)
    })

    it('should handle plugins without hooks', async () => {
      registerPlugin(createTestPlugin('plugin1'))

      // Should not throw
      await expect(executeOnInitHooks({})).resolves.toBeUndefined()
    })
  })

  describe('executeBeforeSyncHooks', () => {
    it('should execute all beforeSync hooks', async () => {
      const beforeSync1 = vi.fn()
      const beforeSync2 = vi.fn()

      registerPlugin(createTestPlugin('plugin1', { hooks: { beforeSync: beforeSync1 } }))
      registerPlugin(createTestPlugin('plugin2', { hooks: { beforeSync: beforeSync2 } }))

      const apps: AppInfo[] = [
        { name: 'web', path: '/apps/web', envExamplePath: '', envLocalPath: '' },
      ]
      await executeBeforeSyncHooks(apps)

      expect(beforeSync1).toHaveBeenCalledWith(apps)
      expect(beforeSync2).toHaveBeenCalledWith(apps)
    })

    it('should skip plugins without beforeSync hook', async () => {
      const beforeSync = vi.fn()

      registerPlugin(createTestPlugin('plugin1', { hooks: { beforeSync } }))
      registerPlugin(createTestPlugin('plugin2', { hooks: {} }))

      await executeBeforeSyncHooks([])

      expect(beforeSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('executeAfterSyncHooks', () => {
    it('should execute all afterSync hooks', async () => {
      const afterSync1 = vi.fn()
      const afterSync2 = vi.fn()

      registerPlugin(createTestPlugin('plugin1', { hooks: { afterSync: afterSync1 } }))
      registerPlugin(createTestPlugin('plugin2', { hooks: { afterSync: afterSync2 } }))

      const results: ReconciliationResult[] = [
        {
          app: { name: 'web', path: '/apps/web', envExamplePath: '', envLocalPath: '' },
          valid: [],
          missing: [],
          extra: [],
          deprecated: [],
          overrides: new Map(),
        },
      ]
      await executeAfterSyncHooks(results)

      expect(afterSync1).toHaveBeenCalledWith(results)
      expect(afterSync2).toHaveBeenCalledWith(results)
    })

    it('should skip plugins without afterSync hook', async () => {
      const afterSync = vi.fn()

      registerPlugin(createTestPlugin('plugin1', { hooks: { afterSync } }))
      registerPlugin(createTestPlugin('plugin2', { hooks: {} }))

      await executeAfterSyncHooks([])

      expect(afterSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('getPluginIgnoreMissing', () => {
    it('should return empty array when no plugins have ignoreMissing', () => {
      registerPlugin(createTestPlugin('plugin'))

      const ignored = getPluginIgnoreMissing()
      expect(ignored).toEqual([])
    })

    it('should aggregate ignoreMissing from all plugins', () => {
      registerPlugin(
        createTestPlugin('plugin1', {
          ignoreMissing: ['VAR1', 'VAR2'],
        })
      )
      registerPlugin(
        createTestPlugin('plugin2', {
          ignoreMissing: ['VAR3'],
        })
      )

      const ignored = getPluginIgnoreMissing()
      expect(ignored).toEqual(['VAR1', 'VAR2', 'VAR3'])
    })

    it('should skip plugins without ignoreMissing', () => {
      registerPlugin(createTestPlugin('plugin1', { ignoreMissing: ['VAR1'] }))
      registerPlugin(createTestPlugin('plugin2'))

      const ignored = getPluginIgnoreMissing()
      expect(ignored).toEqual(['VAR1'])
    })
  })
})
