/**
 * Test plugin that exports default object with meta
 */
import type { EnvDoctorPlugin } from '@/core/types.js'

const plugin: EnvDoctorPlugin = {
  meta: {
    name: 'default-object-test',
    version: '1.0.0',
    description: 'Test plugin with default object export',
  },
}

export default plugin
