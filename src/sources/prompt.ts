/**
 * Interactive prompts for obtaining environment variable values
 */

import * as readline from 'node:readline'
import type { EnvVarDefinition, ResolvedValue, ResolverContext } from '../core/types.js'

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
}

/**
 * Create a readline interface for prompting
 */
function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

/**
 * Prompt user for a single value
 */
async function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim())
    })
  })
}

/**
 * Prompt user for a variable value
 */
export async function promptForValue(
  definition: EnvVarDefinition,
  context: ResolverContext
): Promise<ResolvedValue> {
  // If not interactive, return placeholder
  if (!context.interactive) {
    return {
      value: definition.exampleValue || `REPLACE_ME_${definition.name}`,
      source: 'placeholder',
      warning: `Non-interactive mode: using placeholder for ${definition.name}`,
    }
  }

  const rl = createReadline()

  try {
    // Build prompt message
    const isRequired = definition.requirement === 'required'
    const hint = definition.description || definition.name
    const defaultHint = definition.exampleValue
      ? ` ${colors.dim}(default: ${definition.exampleValue})${colors.reset}`
      : ''
    const skipHint =
      !isRequired && !definition.exampleValue
        ? ` ${colors.dim}(Enter to skip)${colors.reset}`
        : ''

    console.log('')
    console.log(`${colors.cyan}?${colors.reset} ${hint}`)

    const prompt = `  Enter ${definition.name}${defaultHint}${skipHint}: `
    const answer = await askQuestion(rl, prompt)

    // Handle empty answer
    if (!answer) {
      if (definition.exampleValue) {
        // Use example value as default
        return {
          value: definition.exampleValue,
          source: 'prompted',
        }
      }

      if (isRequired) {
        // Required but no value - ask if user wants to skip
        const skipPrompt = `  ${colors.yellow}No value provided.${colors.reset} Skip for now? (y/N): `
        const skipAnswer = await askQuestion(rl, skipPrompt)

        if (skipAnswer.toLowerCase() === 'y') {
          return {
            value: '',
            source: 'prompted',
            skipped: true,
            warning: `Skipped required variable: ${definition.name}`,
          }
        }

        // Re-prompt
        rl.close()
        return promptForValue(definition, context)
      }

      // Optional with no value
      return {
        value: '',
        source: 'prompted',
        skipped: true,
      }
    }

    return {
      value: answer,
      source: 'prompted',
    }
  } finally {
    rl.close()
  }
}

/**
 * Prompt user to confirm an action
 */
export async function confirm(message: string, defaultValue = true): Promise<boolean> {
  const rl = createReadline()

  try {
    const hint = defaultValue ? 'Y/n' : 'y/N'
    const answer = await askQuestion(rl, `${message} (${hint}): `)

    if (!answer) {
      return defaultValue
    }

    return answer.toLowerCase().startsWith('y')
  } finally {
    rl.close()
  }
}

/**
 * Ask user to select from options
 */
export async function select(message: string, options: string[]): Promise<string> {
  if (options.length === 0) {
    throw new Error('select() requires at least one option')
  }

  const rl = createReadline()

  try {
    console.log('')
    console.log(`${colors.cyan}?${colors.reset} ${message}`)

    options.forEach((opt, i) => {
      console.log(`  ${i + 1}. ${opt}`)
    })

    const answer = await askQuestion(rl, `  Select (1-${options.length}): `)
    const index = parseInt(answer, 10) - 1

    if (index >= 0 && index < options.length) {
      return options[index]
    }

    // Default to first option
    return options[0]
  } finally {
    rl.close()
  }
}
