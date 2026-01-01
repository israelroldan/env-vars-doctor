/**
 * Copy values from other variables or apps
 */

import type { EnvVarDefinition, ResolvedValue, ResolverContext } from '../core/types.js'

/**
 * Resolve a value by copying from another variable
 */
export async function resolveCopyValue(
  definition: EnvVarDefinition,
  context: ResolverContext
): Promise<ResolvedValue> {
  const copyFrom = definition.directive.copyFrom

  if (!copyFrom) {
    return {
      value: definition.exampleValue || '',
      source: 'placeholder',
      warning: `No source variable specified for copy directive`,
    }
  }

  // Look up the source variable in current values
  const sourceValue = context.currentValues.get(copyFrom)

  if (sourceValue !== undefined) {
    return {
      value: sourceValue,
      source: 'copied',
    }
  }

  // Source variable not found
  return {
    value: definition.exampleValue || '',
    source: 'placeholder',
    warning: `Source variable ${copyFrom} not found for copying to ${definition.name}`,
  }
}

/**
 * Resolve default value directive
 */
export async function resolveDefaultValue(
  definition: EnvVarDefinition,
  _context: ResolverContext
): Promise<ResolvedValue> {
  const defaultValue = definition.directive.defaultValue

  if (defaultValue !== undefined) {
    return {
      value: defaultValue,
      source: 'default',
    }
  }

  // Use example value as fallback
  return {
    value: definition.exampleValue || '',
    source: 'default',
  }
}

/**
 * Resolve placeholder value
 */
export async function resolvePlaceholderValue(
  definition: EnvVarDefinition,
  _context: ResolverContext
): Promise<ResolvedValue> {
  const value = definition.exampleValue || `REPLACE_ME_${definition.name}`

  return {
    value,
    source: 'placeholder',
    warning:
      definition.requirement === 'required'
        ? `Placeholder used for required variable: ${definition.name}`
        : undefined,
  }
}
