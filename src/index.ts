/**
 * env-vars-doctor - Environment variable management for monorepos
 *
 * @packageDocumentation
 */

// Core types
export type {
  EnvDoctorConfig,
  EnvVarDefinition,
  EnvSchema,
  AppInfo,
  ReconciliationResult,
  ResolvedValue,
  ResolverContext,
  DirectiveType,
  RequirementLevel,
  Directive,
  EnvLocalValues,
  SourceScanResult,
  CliCommand,
  CliOptions,
  ReporterOptions,
  ReportSeverity,
  ReportItem,
} from './core/types.js'

// Plugin types
export type {
  EnvDoctorPlugin,
  PluginMeta,
  ValueSourceProvider,
  DeploymentProvider,
  DeploymentTarget,
  CommandProvider,
  CommandHandler,
  PluginHooks,
} from './core/types.js'

// Config types
export type {
  ProjectConfig,
  WorkspaceConfig,
  ScanningConfig,
  CIConfig,
  PluginsConfig,
  SupabasePluginConfig,
  VercelPluginConfig,
  ExternalPluginRef,
} from './core/types.js'

// Config utilities
export { defineConfig, loadConfig, loadConfigFromFile, DEFAULT_CONFIG } from './core/config.js'
export { isCI, shouldSkip, getDetectedPlatform } from './core/config.js'

// Parser
export {
  parseEnvExample,
  parseEnvLocal,
  mergeSchemas,
  formatEnvFile,
  updateEnvLocalContent,
} from './core/parser.js'

// Scanner
export {
  detectMonorepoRoot,
  getProjectRoot,
  scanWorkspaces,
  scanWorkspacesSync,
  getRootEnvPaths,
  hasEnvExample,
  hasEnvLocal,
  getWorkspacesWithSchema,
  findWorkspace,
  detectCurrentWorkspace,
} from './core/scanner.js'

// Source scanner
export {
  scanAppSources,
  scanPackageSources,
  mergeScanResults,
  diagnoseEnvUsage,
  isIgnoredMissingVar,
  isIgnoredUnusedVar,
} from './core/source-scanner.js'

// Reconciler
export {
  getAppSchema,
  compareSchemaToActual,
  reconcileApp,
  applyUpdates,
  reconcileAllApps,
} from './core/reconciler.js'

// Sources
export {
  resolveValue,
  createValueResolver,
  registerPluginSources,
  getPluginSources,
  clearPluginSources,
  promptForValue,
  confirm,
  select,
  promptForBoolean,
  resolveComputedValue,
  resolveCopyValue,
  resolveDefaultValue,
  resolvePlaceholderValue,
  resolveLocalOnly,
  shouldSkipLocalOnly,
} from './sources/index.js'

// Plugin infrastructure
export {
  registerPlugin,
  registerPlugins,
  getPlugins,
  getValueSources,
  getDeploymentProviders,
  getCommands,
  getHooks,
  findDeploymentProvider,
  findCommand,
  clearRegistry,
  executeOnInitHooks,
  executeBeforeSyncHooks,
  executeAfterSyncHooks,
} from './plugins/registry.js'

export { loadPlugins, createPlugin } from './plugins/loader.js'

// Bundled plugins
export { createSupabasePlugin } from './builtin-plugins/supabase/index.js'
export { createVercelPlugin } from './builtin-plugins/vercel/index.js'

// Reporter (selected exports for programmatic use)
export { setColorsEnabled } from './core/reporter.js'
