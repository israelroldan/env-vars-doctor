/**
 * Test plugin that exports createPlugin function
 */
import type { EnvDoctorPlugin } from '@/core/types.js'

export function createPlugin(options?: Record<string, unknown>): EnvDoctorPlugin {
  return {
    meta: {
      name: 'create-plugin-test',
      version: '1.0.0',
      description: 'Test plugin with createPlugin export',
    },
    ignoreMissing: options?.ignoreMissing as string[] | undefined,
  }
}
