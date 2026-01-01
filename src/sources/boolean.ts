/**
 * Boolean prompt for yes/no environment variable values
 */

import * as readline from 'node:readline'
import type { EnvVarDefinition, ResolvedValue, ResolverContext } from '../core/types.js'

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
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
 * Prompt user for a boolean value (y/n)
 */
export async function promptForBoolean(
  definition: EnvVarDefinition,
  context: ResolverContext
): Promise<ResolvedValue> {
  const yesValue = definition.directive.booleanYes || 'true'
  const noValue = definition.directive.booleanNo || 'false'

  // Determine default from example value
  const exampleIsYes =
    definition.exampleValue === yesValue ||
    definition.exampleValue?.toLowerCase() === 'true' ||
    definition.exampleValue?.toLowerCase() === 'yes'
  const defaultIsYes = exampleIsYes

  // If not interactive, use computed default yes/no value
  if (!context.interactive) {
    const value = defaultIsYes ? yesValue : noValue
    return {
      value,
      source: 'placeholder',
      warning: `Non-interactive mode: using ${value} for ${definition.name}`,
    }
  }

  const rl = createReadline()

  try {
    const hint = definition.description || definition.name
    const defaultHint = defaultIsYes ? 'Y/n' : 'y/N'
    const valuesHint =
      yesValue !== 'true' || noValue !== 'false'
        ? ` ${colors.dim}(${yesValue}/${noValue})${colors.reset}`
        : ''

    console.log('')
    console.log(`${colors.cyan}?${colors.reset} ${hint}${valuesHint}`)

    const prompt = `  ${definition.name} (${defaultHint}): `
    const answer = await askQuestion(rl, prompt)

    // Handle empty answer - use default
    if (!answer) {
      return {
        value: defaultIsYes ? yesValue : noValue,
        source: 'prompted',
      }
    }

    // Parse answer
    const isYes = answer.toLowerCase().startsWith('y')

    return {
      value: isYes ? yesValue : noValue,
      source: 'prompted',
    }
  } finally {
    rl.close()
  }
}
