/**
 * Plugin registry for managing loaded plugins
 */

import type {
  EnvDoctorPlugin,
  ValueSourceProvider,
  DeploymentProvider,
  CommandProvider,
  PluginHooks,
  EnvDoctorConfig,
} from '../core/types.js'

/**
 * Plugin registry state
 */
interface PluginRegistryState {
  /** All loaded plugins */
  plugins: EnvDoctorPlugin[]
  /** Aggregated value sources from all plugins */
  sources: ValueSourceProvider[]
  /** Aggregated deployment providers from all plugins */
  deploymentProviders: DeploymentProvider[]
  /** Aggregated commands from all plugins */
  commands: CommandProvider[]
  /** Aggregated hooks from all plugins */
  hooks: PluginHooks[]
}

/**
 * Global plugin registry
 */
let registry: PluginRegistryState = {
  plugins: [],
  sources: [],
  deploymentProviders: [],
  commands: [],
  hooks: [],
}

/**
 * Register a plugin
 */
export function registerPlugin(plugin: EnvDoctorPlugin): void {
  registry.plugins.push(plugin)

  if (plugin.sources) {
    registry.sources.push(...plugin.sources)
  }

  if (plugin.deploymentProviders) {
    registry.deploymentProviders.push(...plugin.deploymentProviders)
  }

  if (plugin.commands) {
    registry.commands.push(...plugin.commands)
  }

  if (plugin.hooks) {
    registry.hooks.push(plugin.hooks)
  }
}

/**
 * Register multiple plugins
 */
export function registerPlugins(plugins: EnvDoctorPlugin[]): void {
  for (const plugin of plugins) {
    registerPlugin(plugin)
  }
}

/**
 * Get all registered plugins
 */
export function getPlugins(): EnvDoctorPlugin[] {
  return registry.plugins
}

/**
 * Get all registered value sources
 */
export function getValueSources(): ValueSourceProvider[] {
  return registry.sources
}

/**
 * Get all registered deployment providers
 */
export function getDeploymentProviders(): DeploymentProvider[] {
  return registry.deploymentProviders
}

/**
 * Get all registered commands
 */
export function getCommands(): CommandProvider[] {
  return registry.commands
}

/**
 * Get all registered hooks
 */
export function getHooks(): PluginHooks[] {
  return registry.hooks
}

/**
 * Find a deployment provider by name
 */
export function findDeploymentProvider(name: string): DeploymentProvider | undefined {
  return registry.deploymentProviders.find((p) => p.name === name)
}

/**
 * Find a command by name
 */
export function findCommand(name: string): CommandProvider | undefined {
  return registry.commands.find((c) => c.name === name)
}

/**
 * Clear all registered plugins
 */
export function clearRegistry(): void {
  registry = {
    plugins: [],
    sources: [],
    deploymentProviders: [],
    commands: [],
    hooks: [],
  }
}

/**
 * Execute onInit hooks
 */
export async function executeOnInitHooks(config: EnvDoctorConfig): Promise<void> {
  for (const hooks of registry.hooks) {
    if (hooks.onInit) {
      await hooks.onInit(config)
    }
  }
}

/**
 * Execute beforeSync hooks
 */
export async function executeBeforeSyncHooks(
  apps: import('../core/types.js').AppInfo[]
): Promise<void> {
  for (const hooks of registry.hooks) {
    if (hooks.beforeSync) {
      await hooks.beforeSync(apps)
    }
  }
}

/**
 * Execute afterSync hooks
 */
export async function executeAfterSyncHooks(
  results: import('../core/types.js').ReconciliationResult[]
): Promise<void> {
  for (const hooks of registry.hooks) {
    if (hooks.afterSync) {
      await hooks.afterSync(results)
    }
  }
}

/**
 * Get all ignored missing variables from plugins
 */
export function getPluginIgnoreMissing(): string[] {
  const ignored: string[] = []
  for (const plugin of registry.plugins) {
    if (plugin.ignoreMissing) {
      ignored.push(...plugin.ignoreMissing)
    }
  }
  return ignored
}
