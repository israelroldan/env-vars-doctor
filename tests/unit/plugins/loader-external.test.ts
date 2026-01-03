/**
 * Tests for external plugin loading with actual modules
 *
 * This file tests the dynamic import paths in loadExternalPlugin
 * using real fixture modules instead of mocks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// We need to NOT mock the registry here to test the full flow
// But we still mock the builtin plugins to avoid their side effects
vi.mock('@/builtin-plugins/supabase/index.js', () => ({
  createSupabasePlugin: vi.fn(() => ({
    meta: { name: 'supabase', version: '1.0.0', description: 'Supabase plugin' },
  })),
}))

vi.mock('@/builtin-plugins/vercel/index.js', () => ({
  createVercelPlugin: vi.fn(() => ({
    meta: { name: 'vercel', version: '1.0.0', description: 'Vercel plugin' },
  })),
}))

import { loadPlugins } from '@/plugins/loader.js'
import { clearRegistry, getPlugins } from '@/plugins/registry.js'
import type { EnvDoctorConfig } from '@/core/types.js'

describe('loader - external plugin loading', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    clearRegistry()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    clearRegistry()
  })

  it('should load external plugin with createPlugin export', async () => {
    const fixturePath = resolve(__dirname, './fixtures/plugin-with-create-plugin.ts')

    const config: EnvDoctorConfig = {
      plugins: {
        external: [{ name: fixturePath, options: { ignoreMissing: ['VAR1'] } }],
      },
    }

    const plugins = await loadPlugins(config)

    expect(plugins).toHaveLength(1)
    expect(plugins[0].meta.name).toBe('create-plugin-test')
    expect(plugins[0].ignoreMissing).toEqual(['VAR1'])
    expect(consoleWarnSpy).not.toHaveBeenCalled()
  })

  it('should load external plugin with default function export', async () => {
    const fixturePath = resolve(__dirname, './fixtures/plugin-with-default-function.ts')

    const config: EnvDoctorConfig = {
      plugins: {
        external: [{ name: fixturePath, options: { ignoreMissing: ['VAR2'] } }],
      },
    }

    const plugins = await loadPlugins(config)

    expect(plugins).toHaveLength(1)
    expect(plugins[0].meta.name).toBe('default-function-test')
    expect(plugins[0].ignoreMissing).toEqual(['VAR2'])
  })

  it('should load external plugin with default object export', async () => {
    const fixturePath = resolve(__dirname, './fixtures/plugin-with-default-object.ts')

    const config: EnvDoctorConfig = {
      plugins: {
        external: [{ name: fixturePath }],
      },
    }

    const plugins = await loadPlugins(config)

    expect(plugins).toHaveLength(1)
    expect(plugins[0].meta.name).toBe('default-object-test')
  })

  it('should warn and return null for invalid plugin export', async () => {
    const fixturePath = resolve(__dirname, './fixtures/plugin-invalid.ts')

    const config: EnvDoctorConfig = {
      plugins: {
        external: [{ name: fixturePath }],
      },
    }

    const plugins = await loadPlugins(config)

    expect(plugins).toHaveLength(0)
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('does not export a valid plugin')
    )
  })

  it('should load multiple external plugins', async () => {
    const config: EnvDoctorConfig = {
      plugins: {
        external: [
          { name: resolve(__dirname, './fixtures/plugin-with-create-plugin.ts') },
          { name: resolve(__dirname, './fixtures/plugin-with-default-function.ts') },
          { name: resolve(__dirname, './fixtures/plugin-with-default-object.ts') },
        ],
      },
    }

    const plugins = await loadPlugins(config)

    expect(plugins).toHaveLength(3)
    expect(plugins.map((p) => p.meta.name)).toEqual([
      'create-plugin-test',
      'default-function-test',
      'default-object-test',
    ])
  })

  it('should register external plugins in the registry', async () => {
    const fixturePath = resolve(__dirname, './fixtures/plugin-with-create-plugin.ts')

    const config: EnvDoctorConfig = {
      plugins: {
        external: [{ name: fixturePath }],
      },
    }

    await loadPlugins(config)

    const registeredPlugins = getPlugins()
    expect(registeredPlugins).toHaveLength(1)
    expect(registeredPlugins[0].meta.name).toBe('create-plugin-test')
  })

  it('should skip invalid plugins but continue loading others', async () => {
    const config: EnvDoctorConfig = {
      plugins: {
        external: [
          { name: resolve(__dirname, './fixtures/plugin-with-create-plugin.ts') },
          { name: resolve(__dirname, './fixtures/plugin-invalid.ts') },
          { name: resolve(__dirname, './fixtures/plugin-with-default-object.ts') },
        ],
      },
    }

    const plugins = await loadPlugins(config)

    // Invalid plugin is skipped, other two are loaded
    expect(plugins).toHaveLength(2)
    expect(plugins.map((p) => p.meta.name)).toEqual([
      'create-plugin-test',
      'default-object-test',
    ])
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
  })
})
