/**
 * Parser for .env.example files with directive comments
 */

import * as fs from 'node:fs'
import type {
  EnvSchema,
  EnvVarDefinition,
  Directive,
  RequirementLevel,
  EnvLocalValues,
  ValueSourceProvider,
} from './types.js'

// =============================================================================
// Regex Patterns
// =============================================================================

/**
 * Built-in regex patterns for parsing directives
 */
const BUILT_IN_DIRECTIVE_PATTERNS = {
  requirement: /\[(required|optional|deprecated)\]/i,
  prompt: /\[prompt\]/i,
  placeholder: /\[placeholder\]/i,
  computed: /\[computed:(\w+)\]/i,
  copy: /\[copy:([A-Z_][A-Z0-9_]*)\]/i,
  default: /\[default:([^\]]+)\]/i,
  boolean: /\[boolean(?::([^/\]]+)\/([^\]]+))?\]/i,
  localOnly: /\[local-only\]/i,
}

/**
 * Regex pattern for matching environment variable lines
 * Matches: VAR_NAME=value
 */
const VAR_LINE_PATTERN = /^([A-Z_][A-Z0-9_]*)\s*=(.*)$/

/**
 * Regex pattern for matching variable name at start of line
 * Matches: VAR_NAME= (for partial matching)
 */
const VAR_NAME_PATTERN = /^([A-Z_][A-Z0-9_]*)=/

// =============================================================================
// File Operations
// =============================================================================

/**
 * Read and split a file into lines, returning empty array if file doesn't exist
 */
function readFileLines(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    return []
  }
  const content = fs.readFileSync(filePath, 'utf-8')
  return content.split('\n')
}

// =============================================================================
// Parsing Utilities
// =============================================================================

/**
 * Parse a variable line (VAR_NAME=value)
 * Returns null if line doesn't match pattern
 */
function parseVariableLine(line: string): { name: string; value: string } | null {
  const match = line.trim().match(VAR_LINE_PATTERN)
  if (!match) {
    return null
  }
  return { name: match[1], value: match[2] }
}

/**
 * Check if a line is a variable name assignment (VAR_NAME=)
 * Returns the variable name or null
 */
function extractVariableName(line: string): string | null {
  const match = line.trim().match(VAR_NAME_PATTERN)
  return match ? match[1] : null
}

/**
 * Parse a comment line to extract directives and description
 */
function parseCommentLine(
  comment: string,
  pluginSources: ValueSourceProvider[] = []
): {
  requirement: RequirementLevel
  directive: Directive
  description: string
} {
  // Default values
  let requirement: RequirementLevel = 'optional'
  let directive: Directive = { type: 'placeholder' }
  let description = comment

  // Extract requirement level
  const reqMatch = comment.match(BUILT_IN_DIRECTIVE_PATTERNS.requirement)
  if (reqMatch) {
    requirement = reqMatch[1].toLowerCase() as RequirementLevel
    description = description.replace(reqMatch[0], '')
  }

  // Check plugin sources first (they take priority over built-in for custom directives)
  let foundPluginDirective = false
  for (const source of pluginSources) {
    const match = comment.match(source.pattern)
    if (match) {
      directive = { type: source.directiveType, raw: match[0] }
      description = description.replace(match[0], '')
      foundPluginDirective = true
      break
    }
  }

  // Extract built-in directive type (in priority order) if no plugin matched
  if (!foundPluginDirective) {
    if (BUILT_IN_DIRECTIVE_PATTERNS.prompt.test(comment)) {
      directive = { type: 'prompt' }
      description = description.replace(BUILT_IN_DIRECTIVE_PATTERNS.prompt, '')
    } else if (BUILT_IN_DIRECTIVE_PATTERNS.computed.test(comment)) {
      const match = comment.match(BUILT_IN_DIRECTIVE_PATTERNS.computed)!
      directive = { type: 'computed', computeType: match[1] }
      description = description.replace(match[0], '')
    } else if (BUILT_IN_DIRECTIVE_PATTERNS.copy.test(comment)) {
      const match = comment.match(BUILT_IN_DIRECTIVE_PATTERNS.copy)!
      directive = { type: 'copy', copyFrom: match[1] }
      description = description.replace(match[0], '')
    } else if (BUILT_IN_DIRECTIVE_PATTERNS.default.test(comment)) {
      const match = comment.match(BUILT_IN_DIRECTIVE_PATTERNS.default)!
      directive = { type: 'default', defaultValue: match[1] }
      description = description.replace(match[0], '')
    } else if (BUILT_IN_DIRECTIVE_PATTERNS.boolean.test(comment)) {
      const match = comment.match(BUILT_IN_DIRECTIVE_PATTERNS.boolean)!
      directive = {
        type: 'boolean',
        booleanYes: match[1] || 'true',
        booleanNo: match[2] || 'false',
      }
      description = description.replace(match[0], '')
    } else if (BUILT_IN_DIRECTIVE_PATTERNS.localOnly.test(comment)) {
      directive = { type: 'local-only' }
      description = description.replace(BUILT_IN_DIRECTIVE_PATTERNS.localOnly, '')
    } else if (BUILT_IN_DIRECTIVE_PATTERNS.placeholder.test(comment)) {
      directive = { type: 'placeholder' }
      description = description.replace(BUILT_IN_DIRECTIVE_PATTERNS.placeholder, '')
    }
  }

  // Clean up description
  description = description
    .replace(/^#\s*/, '') // Remove leading # and space
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()

  return { requirement, directive, description }
}

// =============================================================================
// Schema Parsing
// =============================================================================

/**
 * Options for parsing an env example file
 */
export interface ParseOptions {
  /** Plugin-provided value sources (for custom directive patterns) */
  pluginSources?: ValueSourceProvider[]
}

/**
 * Parse a .env.example file into a schema
 */
export function parseEnvExample(filePath: string, options: ParseOptions = {}): EnvSchema {
  const { pluginSources = [] } = options
  const lines = readFileLines(filePath)
  const variables: EnvVarDefinition[] = []

  let pendingComment = ''

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines
    if (!trimmed) {
      pendingComment = ''
      continue
    }

    // Accumulate comments
    if (trimmed.startsWith('#')) {
      if (pendingComment) {
        pendingComment += ' ' + trimmed.substring(1).trim()
      } else {
        pendingComment = trimmed.substring(1).trim()
      }
      continue
    }

    // Parse variable line
    const parsed = parseVariableLine(line)
    if (parsed) {
      const { requirement, directive, description } = parseCommentLine(
        pendingComment,
        pluginSources
      )

      variables.push({
        name: parsed.name,
        exampleValue: parsed.value,
        requirement,
        directive,
        description,
        rawComment: pendingComment,
      })

      pendingComment = ''
    }
  }

  return { filePath, variables }
}

/**
 * Parse an existing .env.local file
 */
export function parseEnvLocal(filePath: string): EnvLocalValues {
  const lines = readFileLines(filePath)
  const values = new Map<string, string>()
  const comments = new Map<string, string>()

  // Get original content for preservation
  const originalContent = lines.length > 0 ? fs.readFileSync(filePath, 'utf-8') : ''

  let pendingComment = ''

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines
    if (!trimmed) {
      pendingComment = ''
      continue
    }

    // Accumulate comments
    if (trimmed.startsWith('#')) {
      pendingComment = trimmed
      continue
    }

    // Parse variable line
    const parsed = parseVariableLine(line)
    if (parsed) {
      values.set(parsed.name, parsed.value)
      if (pendingComment) {
        comments.set(parsed.name, pendingComment)
      }
      pendingComment = ''
    }
  }

  return { values, comments, originalContent }
}

// =============================================================================
// Schema Operations
// =============================================================================

/**
 * Merge two schemas (shared + app-specific)
 * App-specific variables override shared ones with the same name
 */
export function mergeSchemas(shared: EnvSchema, appSpecific: EnvSchema): EnvVarDefinition[] {
  const merged = new Map<string, EnvVarDefinition>()

  // Add shared variables first
  for (const variable of shared.variables) {
    merged.set(variable.name, variable)
  }

  // Override with app-specific variables
  for (const variable of appSpecific.variables) {
    merged.set(variable.name, variable)
  }

  return Array.from(merged.values())
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Format a schema back to .env file content
 */
export function formatEnvFile(
  variables: Array<{ name: string; value: string; comment?: string }>
): string {
  const lines: string[] = []

  for (const { name, value, comment } of variables) {
    if (comment) {
      lines.push(comment)
    }
    lines.push(`${name}=${value}`)
    lines.push('')
  }

  return lines.join('\n').trim() + '\n'
}

/**
 * Update .env.local content with new/changed values
 * Preserves existing structure and comments where possible
 */
export function updateEnvLocalContent(
  original: EnvLocalValues,
  updates: Map<string, string>,
  schema: EnvVarDefinition[]
): string {
  const lines: string[] = []
  const processed = new Set<string>()

  // If there's existing content, update in place
  if (original.originalContent) {
    const originalLines = original.originalContent.split('\n')

    for (const line of originalLines) {
      const trimmed = line.trim()

      // Pass through empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        lines.push(line)
        continue
      }

      // Check if it's a variable line
      const varName = extractVariableName(line)
      if (varName) {
        processed.add(varName)

        // Use updated value if available, otherwise keep original
        if (updates.has(varName)) {
          lines.push(`${varName}=${updates.get(varName)}`)
        } else {
          lines.push(line)
        }
      } else {
        lines.push(line)
      }
    }
  }

  // Add any new variables not in original
  const newVars: string[] = []
  for (const [name, value] of updates) {
    if (!processed.has(name)) {
      // Find the schema definition for this variable
      const def = schema.find((v) => v.name === name)
      if (def?.description) {
        newVars.push(`# ${def.description}`)
      }
      newVars.push(`${name}=${value}`)
      newVars.push('')
    }
  }

  if (newVars.length > 0) {
    // Add separator if there's existing content
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
      lines.push('')
    }
    lines.push(...newVars)
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
