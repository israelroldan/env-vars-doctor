/**
 * Value source resolution with plugin support
 */

import type {
  EnvVarDefinition,
  ResolvedValue,
  ResolverContext,
  ValueSourceProvider,
} from '../core/types.js'
import { promptForValue } from './prompt.js'
import { promptForBoolean } from './boolean.js'
import { resolveComputedValue } from './computed.js'
import { resolveCopyValue, resolveDefaultValue, resolvePlaceholderValue } from './copy.js'
import { resolveLocalOnly } from './local-only.js'

// Re-export built-in sources
export { promptForValue, confirm, select } from './prompt.js'
export { promptForBoolean } from './boolean.js'
export { resolveComputedValue } from './computed.js'
export { resolveCopyValue, resolveDefaultValue, resolvePlaceholderValue } from './copy.js'
export { resolveLocalOnly, shouldSkipLocalOnly } from './local-only.js'

/**
 * Registry of plugin-provided value sources
 */
let pluginSources: ValueSourceProvider[] = []

/**
 * Register plugin-provided value sources
 */
export function registerPluginSources(sources: ValueSourceProvider[]): void {
  pluginSources = sources
}

/**
 * Get all registered plugin sources
 */
export function getPluginSources(): ValueSourceProvider[] {
  return pluginSources
}

/**
 * Clear all registered plugin sources
 */
export function clearPluginSources(): void {
  pluginSources = []
}

/**
 * Find a plugin source that handles a directive type
 */
function findPluginSource(directiveType: string): ValueSourceProvider | undefined {
  return pluginSources.find((source) => source.directiveType === directiveType)
}

/**
 * Resolve a value for a variable based on its directive
 */
export async function resolveValue(
  definition: EnvVarDefinition,
  context: ResolverContext
): Promise<ResolvedValue> {
  // First check if value already exists
  const existingValue = context.currentValues.get(definition.name)
  if (existingValue !== undefined && existingValue !== '') {
    return {
      value: existingValue,
      source: 'existing',
    }
  }

  // Resolve based on directive type
  const { type } = definition.directive

  // Check for plugin source first
  const pluginSource = findPluginSource(type)
  if (pluginSource) {
    // Check if plugin source is available
    if (pluginSource.isAvailable) {
      const isAvailable = await Promise.resolve(pluginSource.isAvailable(context))
      if (!isAvailable) {
        return {
          value: definition.exampleValue || '',
          source: 'placeholder',
          warning: pluginSource.unavailableMessage || `Plugin source "${type}" is not available`,
        }
      }
    }
    return pluginSource.resolve(definition, context)
  }

  // Built-in sources
  switch (type) {
    case 'prompt':
      return promptForValue(definition, context)

    case 'boolean':
      return promptForBoolean(definition, context)

    case 'computed':
      return resolveComputedValue(definition, context)

    case 'copy':
      return resolveCopyValue(definition, context)

    case 'default':
      return resolveDefaultValue(definition, context)

    case 'local-only':
      return resolveLocalOnly(definition, context)

    case 'placeholder':
    default:
      return resolvePlaceholderValue(definition, context)
  }
}

/**
 * Create a value resolver function that uses registered plugins
 */
export function createValueResolver(
  customSources?: ValueSourceProvider[]
): (definition: EnvVarDefinition, context: ResolverContext) => Promise<ResolvedValue> {
  // Temporarily register custom sources if provided
  const originalSources = pluginSources

  return async (definition, context) => {
    if (customSources) {
      pluginSources = [...originalSources, ...customSources]
    }

    try {
      return await resolveValue(definition, context)
    } finally {
      if (customSources) {
        pluginSources = originalSources
      }
    }
  }
}
