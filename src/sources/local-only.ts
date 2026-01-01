/**
 * Local-only value handling for environment variables
 *
 * Variables marked with [local-only] are only needed for local development
 * and should be skipped in CI/deployment contexts.
 */

import type { EnvVarDefinition, ResolvedValue, ResolverContext } from '../core/types.js'
import { isCI } from '../core/config.js'

/**
 * Check if a local-only variable should be skipped
 */
export function shouldSkipLocalOnly(context: ResolverContext): boolean {
  // Skip in CI environments
  if (isCI(context.config)) {
    return true
  }

  // Skip in non-interactive mode (likely CI or automated process)
  if (!context.interactive) {
    return true
  }

  return false
}

/**
 * Resolve a local-only variable
 *
 * In CI/non-interactive mode: skips the variable
 * In local interactive mode: uses default value or prompts
 */
export async function resolveLocalOnly(
  definition: EnvVarDefinition,
  context: ResolverContext
): Promise<ResolvedValue> {
  // In CI or non-interactive mode, skip this variable
  if (shouldSkipLocalOnly(context)) {
    return {
      value: '',
      source: 'default',
      skipped: true,
    }
  }

  // In local interactive mode, use the default value if available
  const defaultValue = definition.directive.defaultValue || definition.exampleValue

  if (defaultValue) {
    return {
      value: defaultValue,
      source: 'default',
    }
  }

  // No default, return empty (this is expected for local-only optional vars)
  return {
    value: '',
    source: 'default',
  }
}
