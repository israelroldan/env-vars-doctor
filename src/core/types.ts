/**
 * env-doctor core type definitions
 */

// =============================================================================
// Directive Types
// =============================================================================

/**
 * Built-in directive types that can appear in .env.example comments
 */
export type BuiltInDirectiveType =
  | 'prompt'      // Ask user interactively
  | 'placeholder' // Use example value, add TODO comment
  | 'computed'    // Generate based on app context (e.g., port)
  | 'copy'        // Copy from another variable
  | 'default'     // Use default value if not set
  | 'boolean'     // Yes/no prompt with configurable values
  | 'local-only'  // Skip in CI, only needed for local development

/**
 * Directive type - can be built-in or plugin-provided
 */
export type DirectiveType = BuiltInDirectiveType | string

/**
 * Requirement level for a variable
 */
export type RequirementLevel = 'required' | 'optional' | 'deprecated'

/**
 * Parsed directive from a comment
 */
export interface Directive {
  type: DirectiveType
  /** For 'computed' - what to compute (e.g., 'port') */
  computeType?: string
  /** For 'copy' - variable name to copy from */
  copyFrom?: string
  /** For 'default' - the default value */
  defaultValue?: string
  /** For 'boolean' - value when yes (default: 'true') */
  booleanYes?: string
  /** For 'boolean' - value when no (default: 'false') */
  booleanNo?: string
  /** Raw directive string for plugin parsing */
  raw?: string
}

// =============================================================================
// Schema Types
// =============================================================================

/**
 * A single environment variable definition from .env.example
 */
export interface EnvVarDefinition {
  /** Variable name (e.g., 'WORKOS_API_KEY') */
  name: string
  /** Example/default value from the file */
  exampleValue: string
  /** Whether required, optional, or deprecated */
  requirement: RequirementLevel
  /** How to obtain the value */
  directive: Directive
  /** Human-readable description */
  description: string
  /** Original comment line(s) */
  rawComment: string
}

/**
 * Parsed schema from a .env.example file
 */
export interface EnvSchema {
  /** Source file path */
  filePath: string
  /** All variable definitions */
  variables: EnvVarDefinition[]
}

// =============================================================================
// Workspace Types
// =============================================================================

/**
 * An app/workspace in the monorepo
 */
export interface AppInfo {
  /** App name (e.g., 'client-portal') */
  name: string
  /** Directory path */
  path: string
  /** Path to .env.example */
  envExamplePath: string
  /** Path to .env.local */
  envLocalPath: string
}

/**
 * Current values from .env.local
 */
export interface EnvLocalValues {
  /** Variable name -> value */
  values: Map<string, string>
  /** Variables that have comments (for preservation) */
  comments: Map<string, string>
  /** Original file content for diffing */
  originalContent: string
}

// =============================================================================
// Reconciliation Types
// =============================================================================

/**
 * Result of comparing schema to actual values
 */
export interface ReconciliationResult {
  /** App being checked */
  app: AppInfo
  /** Variables that exist and are valid */
  valid: EnvVarDefinition[]
  /** Variables missing from .env.local */
  missing: EnvVarDefinition[]
  /** Variables in .env.local but not in schema */
  extra: string[]
  /** Variables marked as deprecated that still exist */
  deprecated: string[]
  /** Shared variables that have a different value in this app (name -> app value) */
  overrides: Map<string, string>
}

// =============================================================================
// Resolution Types
// =============================================================================

/**
 * Result of resolving a value for a variable
 */
export interface ResolvedValue {
  /** The resolved value */
  value: string
  /** How it was resolved */
  source: string
  /** Whether user skipped this variable */
  skipped?: boolean
  /** Warning message if any */
  warning?: string
}

/**
 * Context passed to value resolvers
 */
export interface ResolverContext {
  /** Current app info */
  app: AppInfo
  /** All current .env.local values */
  currentValues: Map<string, string>
  /** Whether to actually prompt (false in check mode) */
  interactive: boolean
  /** The fully resolved config (merged with defaults) */
  config: Required<EnvDoctorConfig>
  /** Root directory of the project */
  rootDir: string
}

// =============================================================================
// CLI Types
// =============================================================================

/**
 * Available CLI commands
 */
export type CliCommand =
  | 'sync'
  | 'status'
  | 'check'
  | 'postinstall'
  | 'clean'
  | 'ci'
  | 'diagnose'
  | 'export'

/**
 * CLI options
 */
export interface CliOptions {
  /** Run mode */
  command: CliCommand
  /** Specific app to process (or all) */
  app?: string
  /** Verbose output */
  verbose?: boolean
  /** Force overwrite */
  force?: boolean
  /** Export format */
  format?: 'vercel' | 'shell' | 'json'
  /** Target environment */
  target?: string
}

// =============================================================================
// Source Code Scanning Types
// =============================================================================

/**
 * Result of scanning source code for env usage
 */
export interface SourceScanResult {
  /** App that was scanned */
  app: AppInfo
  /** Variables used in code but not in schema */
  undocumented: string[]
  /** Variables in schema but not used in code */
  unused: string[]
  /** Variables used in code (for reference) */
  used: string[]
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Workspace detection method
 */
export type WorkspaceDetection = 'auto' | 'pnpm' | 'npm' | 'yarn' | 'manual'

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** How to detect workspaces */
  detection?: WorkspaceDetection
  /** Glob patterns for workspace directories */
  patterns?: string[]
  /** Source directory within each workspace (default: 'src') */
  sourceDir?: string
}

/**
 * Source code scanning configuration
 */
export interface ScanningConfig {
  /** File extensions to scan */
  extensions?: string[]
  /** Directories to skip */
  skipDirs?: string[]
  /** Variables to ignore when checking for missing (platform vars like CI, VERCEL) */
  ignoreMissing?: string[]
  /** Variables to ignore when checking for unused */
  ignoreUnused?: string[]
}

/**
 * CI configuration
 */
export interface CIConfig {
  /** Environment variable that skips env-doctor when set */
  skipEnvVar?: string
  /** Directives to skip in CI mode */
  skipDirectives?: string[]
  /** Environment variable detection mapping (name -> [env vars that indicate it]) */
  detection?: Record<string, string[]>
}

/**
 * Supabase plugin configuration
 */
export interface SupabasePluginConfig {
  /** Enable the plugin */
  enabled?: boolean
  /** Directory containing Supabase config */
  databaseDir?: string
  /** Variable name -> Supabase key mapping */
  variableMapping?: Record<string, string>
}

/**
 * Vercel plugin configuration
 */
export interface VercelPluginConfig {
  /** Enable the plugin */
  enabled?: boolean
  /** App name -> Vercel project ID mapping */
  projectMapping?: Record<string, string>
  /** File to parse for project mapping (e.g., GitHub Actions workflow) */
  projectMappingSource?: string
}

/**
 * External plugin reference
 */
export interface ExternalPluginRef {
  /** Plugin package name or path */
  name: string
  /** Plugin-specific options */
  options?: Record<string, unknown>
}

/**
 * Plugins configuration
 */
export interface PluginsConfig {
  /** Supabase integration */
  supabase?: SupabasePluginConfig
  /** Vercel deployment */
  vercel?: VercelPluginConfig
  /** External plugins */
  external?: ExternalPluginRef[]
}

/**
 * Project configuration
 */
export interface ProjectConfig {
  /** Root .env.example file path */
  rootEnvExample?: string
  /** Root .env.local file path */
  rootEnvLocal?: string
  /** Workspace configuration */
  workspaces?: WorkspaceConfig
}

/**
 * Main configuration object
 */
export interface EnvDoctorConfig {
  /** Config version */
  version?: '1'
  /** Project configuration */
  project?: ProjectConfig
  /** Source code scanning configuration */
  scanning?: ScanningConfig
  /** CI configuration */
  ci?: CIConfig
  /** Plugin configuration */
  plugins?: PluginsConfig
}

// =============================================================================
// Plugin Types
// =============================================================================

/**
 * Plugin metadata
 */
export interface PluginMeta {
  /** Plugin name */
  name: string
  /** Plugin version */
  version: string
  /** Plugin description */
  description?: string
}

/**
 * Value source provider - handles a directive type
 */
export interface ValueSourceProvider {
  /** The directive type this handles (e.g., 'supabase') */
  directiveType: string
  /** Pattern to match in comments */
  pattern: RegExp
  /** Resolve the value for a variable */
  resolve: (definition: EnvVarDefinition, context: ResolverContext) => Promise<ResolvedValue>
  /** Check if this source is available */
  isAvailable?: (context: ResolverContext) => boolean | Promise<boolean>
  /** Message to show when unavailable */
  unavailableMessage?: string
}

/**
 * Deployment target info
 */
export interface DeploymentTarget {
  /** Target name (e.g., 'production', 'preview') */
  name: string
  /** Provider-specific ID */
  id?: string
}

/**
 * Deployment provider - handles deploying env vars to a platform
 */
export interface DeploymentProvider {
  /** Provider name (e.g., 'vercel') */
  name: string
  /** Get available deployment targets */
  getTargets: (app: AppInfo, context: ResolverContext) => Promise<DeploymentTarget[]>
  /** Deploy environment variables */
  deploy: (
    app: AppInfo,
    variables: Map<string, string>,
    target: DeploymentTarget,
    context: ResolverContext
  ) => Promise<{ success: boolean; message: string }>
  /** Check if this provider is available */
  isAvailable?: (context: ResolverContext) => boolean | Promise<boolean>
  /** Message to show when unavailable */
  unavailableMessage?: string
}

/**
 * Command handler function
 */
export type CommandHandler = (
  args: string[],
  context: ResolverContext
) => Promise<{ exitCode: number }>

/**
 * Command provider - adds custom CLI commands
 */
export interface CommandProvider {
  /** Command name */
  name: string
  /** Command description */
  description: string
  /** Command usage */
  usage?: string
  /** Command handler */
  handler: CommandHandler
}

/**
 * Plugin lifecycle hooks
 */
export interface PluginHooks {
  /** Called when env-doctor initializes */
  onInit?: (config: EnvDoctorConfig) => Promise<void> | void
  /** Called before sync starts */
  beforeSync?: (apps: AppInfo[]) => Promise<void> | void
  /** Called after sync completes */
  afterSync?: (results: ReconciliationResult[]) => Promise<void> | void
  /** Called before a variable is resolved */
  beforeResolve?: (definition: EnvVarDefinition, context: ResolverContext) => Promise<void> | void
  /** Called after a variable is resolved */
  afterResolve?: (
    definition: EnvVarDefinition,
    result: ResolvedValue,
    context: ResolverContext
  ) => Promise<void> | void
}

/**
 * Plugin interface
 */
export interface EnvDoctorPlugin {
  /** Plugin metadata */
  meta: PluginMeta
  /** Value source providers */
  sources?: ValueSourceProvider[]
  /** Deployment providers */
  deploymentProviders?: DeploymentProvider[]
  /** Custom CLI commands */
  commands?: CommandProvider[]
  /** Lifecycle hooks */
  hooks?: PluginHooks
  /** Variables to ignore in "missing" checks (platform-provided vars) */
  ignoreMissing?: string[]
}

// =============================================================================
// Reporter Types
// =============================================================================

/**
 * Reporter output options
 */
export interface ReporterOptions {
  /** Use colors in output */
  colors?: boolean
  /** Verbose output */
  verbose?: boolean
  /** Output format */
  format?: 'human' | 'json' | 'ci'
}

/**
 * Report severity level
 */
export type ReportSeverity = 'info' | 'warning' | 'error' | 'success'

/**
 * A single report item
 */
export interface ReportItem {
  /** Severity level */
  severity: ReportSeverity
  /** Message */
  message: string
  /** Associated variable name */
  variable?: string
  /** Associated app name */
  app?: string
}
