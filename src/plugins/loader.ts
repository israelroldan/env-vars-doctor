/**
 * Plugin loader for discovering and loading plugins
 */

import type { EnvDoctorPlugin, EnvDoctorConfig } from '../core/types.js'
import { registerPlugin, registerPlugins, clearRegistry, getValueSources } from './registry.js'
import { registerPluginSources } from '../sources/index.js'

// Import bundled plugins
import { createSupabasePlugin } from '../builtin-plugins/supabase/index.js'
import { createVercelPlugin } from '../builtin-plugins/vercel/index.js'

/**
 * Load plugins based on configuration
 */
export async function loadPlugins(config: EnvDoctorConfig): Promise<EnvDoctorPlugin[]> {
  // Clear existing plugins
  clearRegistry()

  const loadedPlugins: EnvDoctorPlugin[] = []

  // Load bundled plugins based on config
  const pluginsConfig = config.plugins || {}

  // Supabase plugin
  if (pluginsConfig.supabase?.enabled) {
    const supabasePlugin = createSupabasePlugin(pluginsConfig.supabase)
    registerPlugin(supabasePlugin)
    loadedPlugins.push(supabasePlugin)
  }

  // Vercel plugin
  if (pluginsConfig.vercel?.enabled) {
    const vercelPlugin = createVercelPlugin(pluginsConfig.vercel)
    registerPlugin(vercelPlugin)
    loadedPlugins.push(vercelPlugin)
  }

  // Load external plugins
  if (pluginsConfig.external) {
    for (const externalRef of pluginsConfig.external) {
      try {
        const externalPlugin = await loadExternalPlugin(externalRef.name, externalRef.options)
        if (externalPlugin) {
          registerPlugin(externalPlugin)
          loadedPlugins.push(externalPlugin)
        }
      } catch (error) {
        console.warn(
          `Failed to load external plugin "${externalRef.name}": ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  // Register all value sources with the sources module
  registerPluginSources(getValueSources())

  return loadedPlugins
}

/**
 * Load an external plugin by name
 */
async function loadExternalPlugin(
  name: string,
  options?: Record<string, unknown>
): Promise<EnvDoctorPlugin | null> {
  try {
    // Try to dynamically import the plugin
    const module = await import(name)

    // Check for factory function or default export
    if (typeof module.createPlugin === 'function') {
      return module.createPlugin(options)
    }

    if (typeof module.default === 'function') {
      return module.default(options)
    }

    if (module.default && typeof module.default === 'object' && 'meta' in module.default) {
      return module.default as EnvDoctorPlugin
    }

    console.warn(`Plugin "${name}" does not export a valid plugin`)
    return null
  } catch (error) {
    // Plugin not found or failed to load
    throw error
  }
}

/**
 * Create a plugin from a factory function
 */
export function createPlugin(
  meta: EnvDoctorPlugin['meta'],
  options: Omit<EnvDoctorPlugin, 'meta'>
): EnvDoctorPlugin {
  return {
    meta,
    ...options,
  }
}

// Re-export registry functions for convenience
export { registerPlugin, registerPlugins, getValueSources } from './registry.js'
