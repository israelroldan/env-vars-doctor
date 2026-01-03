/**
 * Test plugin that exports default function
 */
import type { EnvDoctorPlugin } from '@/core/types.js'

export default function (options?: Record<string, unknown>): EnvDoctorPlugin {
  return {
    meta: {
      name: 'default-function-test',
      version: '1.0.0',
      description: 'Test plugin with default function export',
    },
    ignoreMissing: options?.ignoreMissing as string[] | undefined,
  }
}
