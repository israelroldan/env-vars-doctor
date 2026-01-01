/**
 * Computed value generation for environment variables
 *
 * Currently supports limited compute types. Port-based computation
 * was removed - if you need dynamic ports, use the 'prompt' directive
 * or set values manually.
 */

import type { EnvVarDefinition, ResolvedValue, ResolverContext } from '../core/types.js'

/**
 * Resolve a computed value based on the compute type
 */
export async function resolveComputedValue(
  definition: EnvVarDefinition,
  _context: ResolverContext
): Promise<ResolvedValue> {
  const computeType = definition.directive.computeType

  // For now, all compute types fall back to using the example value
  // Port-based computation was removed - if you need dynamic ports,
  // use the 'prompt' directive or set values manually
  return {
    value: definition.exampleValue || '',
    source: 'placeholder',
    warning: computeType
      ? `Computed type '${computeType}' not supported, using example value`
      : 'No compute type specified, using example value',
  }
}
