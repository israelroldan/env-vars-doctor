/**
 * Deploy command - Check and sync environment variables to Vercel
 *
 * This command:
 * 1. Checks team-level shared env vars against Vercel
 * 2. Checks project-level env vars for each app
 * 3. Validates production AND non-production targets
 * 4. Proposes changes and asks for confirmation
 * 5. Applies changes if confirmed
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import type { EnvDoctorConfig } from '../core/types.js'
import { scanWorkspaces, getRootEnvPaths, hasEnvExample } from '../core/scanner.js'
import { parseEnvLocal, parseEnvExample } from '../core/parser.js'
import * as reporter from '../core/reporter.js'

interface DeployOptions {
  app?: string
  all?: boolean
  verbose?: boolean
  target?: string
  dryRun?: boolean
  rootDir: string
  config: Required<EnvDoctorConfig>
}

interface RemoteVar {
  id?: string
  key: string
  target: string[]
  allCustomEnvs?: boolean
  projects?: string[]
}

type PlannedAction =
  | {
      kind: 'create-shared'
      key: string
      value: string
      targets: string[]
      allCustomEnvs?: boolean
      promptValue?: boolean
    }
  | {
      kind: 'create-project'
      projectId: string
      projectName: string
      key: string
      value: string
      targets: string[]
      allCustomEnvs?: boolean
      promptValue?: boolean
    }
  | {
      kind: 'update-shared-targets'
      id: string
      key: string
      targets: string[]
      allCustomEnvs?: boolean
    }
  | {
      kind: 'link-shared'
      id: string
      key: string
      projects: string[]
    }

/**
 * Prompt for user input
 */
async function promptInput(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return await new Promise<string>((resolve) => {
    rl.question(defaultValue ? `${question} (default: ${defaultValue}): ` : `${question}: `, (answer) => {
      rl.close()
      const val = answer.trim()
      if (val === '' && defaultValue !== undefined) {
        resolve(defaultValue)
      } else {
        resolve(val)
      }
    })
  })
}

/**
 * Fetch all team-level shared env vars from Vercel with pagination
 */
async function fetchTeamSharedEnvVars(
  token: string,
  teamId: string,
  projectId?: string
): Promise<RemoteVar[]> {
  const vars: RemoteVar[] = []
  let url = `https://api.vercel.com/v1/env?teamId=${teamId}&limit=100${projectId ? `&projectId=${projectId}` : ''}`

  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch shared env vars: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as {
      data?: Array<{
        id: string
        key: string
        target: string | string[]
        includeAllEnvironments?: boolean
        includeAllCustomEnvironments?: boolean
        projects?: string[]
      }>
      pagination?: { next?: number }
    }
    const pageVars: RemoteVar[] = (data.data || []).map((item) => ({
      id: item.id,
      key: item.key,
      target: Array.isArray(item.target) ? item.target : item.target ? [item.target] : [],
      allCustomEnvs:
        item.includeAllEnvironments || item.includeAllCustomEnvironments || item.target === 'all',
      projects: item.projects || [],
    }))

    vars.push(...pageVars)

    const next = data.pagination?.next
    if (next) {
      const urlObj = new URL(url)
      urlObj.searchParams.set('until', String(next))
      url = urlObj.toString()
    } else {
      break
    }
  }

  return vars
}

/**
 * Fetch project-level env vars with pagination
 */
async function fetchProjectEnvVars(
  token: string,
  teamId: string,
  projectId: string
): Promise<RemoteVar[]> {
  const vars: RemoteVar[] = []
  let url = `https://api.vercel.com/v9/projects/${projectId}/env?teamId=${teamId}&limit=100`

  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error(
        `Failed to fetch project env vars for ${projectId}: ${response.status} ${response.statusText}`
      )
    }

    const data = (await response.json()) as {
      envs?: Array<{
        id: string
        key?: string
        name?: string
        target: string | string[]
        includeAllEnvironments?: boolean
        includeAllCustomEnvironments?: boolean
        projects?: string[]
      }>
      environmentVariables?: Array<{
        id: string
        key?: string
        name?: string
        target: string | string[]
        includeAllEnvironments?: boolean
        includeAllCustomEnvironments?: boolean
        projects?: string[]
      }>
      pagination?: { next?: number }
    }
    const envs = Array.isArray(data) ? data : data.envs || data.environmentVariables || []
    const pageVars: RemoteVar[] = envs
      .map((item) => ({
        id: item.id,
        key: item.key || item.name || '',
        target: Array.isArray(item.target) ? item.target : item.target ? [item.target] : [],
        allCustomEnvs:
          item.includeAllEnvironments || item.includeAllCustomEnvironments || item.target === 'all',
        projects: item.projects || [],
      }))
      .filter((e) => e.key)

    vars.push(...pageVars)

    const next = data.pagination?.next
    if (next) {
      const urlObj = new URL(url)
      urlObj.searchParams.set('until', String(next))
      url = urlObj.toString()
    } else {
      break
    }
  }

  return vars
}

/**
 * Apply planned actions to Vercel
 */
async function applyPlannedActions(
  actions: PlannedAction[],
  token: string,
  teamId: string
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  for (const action of actions) {
    if (action.kind === 'create-shared') {
      let value = action.value
      if (action.promptValue) {
        value = await promptInput(`Production value for ${action.key}`, action.value)
      }
      const body: Record<string, unknown> = {
        key: action.key,
        value,
        target: action.targets,
        type: 'encrypted',
      }
      if (action.allCustomEnvs) {
        body.includeAllEnvironments = true
        body.includeAllCustomEnvironments = true
      }
      const resp = await fetch(`https://api.vercel.com/v1/env?teamId=${teamId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text()
        throw new Error(
          `Failed to create shared var ${action.key} (${action.targets.join(', ')}): ${resp.status} ${resp.statusText} ${err}`
        )
      }
    } else if (action.kind === 'update-shared-targets') {
      const body: Record<string, unknown> = {
        id: action.id,
        target: action.targets,
      }
      if (action.allCustomEnvs) {
        body.includeAllEnvironments = true
        body.includeAllCustomEnvironments = true
      }
      const resp = await fetch(`https://api.vercel.com/v1/env?teamId=${teamId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text()
        throw new Error(
          `Failed to update targets for ${action.key}: ${resp.status} ${resp.statusText} ${err}`
        )
      }
    } else if (action.kind === 'link-shared') {
      const body = {
        updates: {
          [action.id]: {
            projectIdUpdates: {
              link: action.projects,
            },
          },
        },
      }
      const resp = await fetch(`https://api.vercel.com/v1/env?teamId=${teamId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text()
        throw new Error(
          `Failed to link shared var ${action.key} to projects ${action.projects.join(', ')}: ${resp.status} ${resp.statusText} ${err}`
        )
      }
    } else if (action.kind === 'create-project') {
      let value = action.value
      if (action.promptValue) {
        value = await promptInput(`Production value for ${action.key} (${action.projectName})`, action.value)
      }
      const body: Record<string, unknown> = {
        key: action.key,
        value,
        target: action.targets,
        type: 'encrypted',
      }
      if (action.allCustomEnvs) {
        body.includeAllEnvironments = true
        body.includeAllCustomEnvironments = true
      }
      const resp = await fetch(
        `https://api.vercel.com/v9/projects/${action.projectId}/env?teamId=${teamId}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }
      )
      if (!resp.ok) {
        const err = await resp.text()
        throw new Error(
          `Failed to create project var ${action.key} for ${action.projectName}: ${resp.status} ${resp.statusText} ${err}`
        )
      }
    }
  }
}

/**
 * Parse project mapping from workflow file
 */
function parseProjectMappingFromWorkflow(workflowPath: string): Map<string, string> {
  const projectMap = new Map<string, string>()
  if (!fs.existsSync(workflowPath)) {
    return projectMap
  }

  const content = fs.readFileSync(workflowPath, 'utf-8')
  const projectRegex = /\["([^"]+)"\]="([^"]+)"/g
  let match
  while ((match = projectRegex.exec(content)) !== null) {
    projectMap.set(match[1], match[2])
  }

  return projectMap
}

/**
 * Run the deploy command
 */
export async function runDeploy(options: DeployOptions): Promise<number> {
  const { dryRun, rootDir, config } = options

  const token = process.env.VERCEL_TOKEN
  const teamId = process.env.VERCEL_TEAM_ID

  if (!token || !teamId) {
    reporter.printError('VERCEL_TOKEN and VERCEL_TEAM_ID are required for deploy command')
    return 1
  }

  const { examplePath: rootExamplePath, localPath: rootLocalPath } = getRootEnvPaths(config, rootDir)
  const rootSchema = parseEnvExample(rootExamplePath)
  const sharedVarNames = rootSchema.variables.map((v) => v.name)
  const rootLocal = fs.existsSync(rootLocalPath)
    ? parseEnvLocal(rootLocalPath).values
    : new Map<string, string>()

  console.log('🔍 Checking team shared env vars...')

  // Fetch team-level shared vars
  let remoteVars: RemoteVar[] = []
  try {
    remoteVars = await fetchTeamSharedEnvVars(token, teamId)
  } catch (error) {
    reporter.printError(error instanceof Error ? error.message : 'Failed to fetch shared env vars')
    return 1
  }

  // Build lookup map for remote vars
  const remoteMap = new Map<string, { target: string[]; allCustomEnvs?: boolean; id?: string }>()
  remoteVars.forEach((v) => {
    if (!remoteMap.has(v.key)) {
      remoteMap.set(v.key, { target: v.target, allCustomEnvs: v.allCustomEnvs, id: v.id })
    } else {
      const existing = remoteMap.get(v.key)!
      const merged = Array.from(new Set([...(existing.target || []), ...v.target]))
      remoteMap.set(v.key, {
        target: merged,
        allCustomEnvs: existing.allCustomEnvs || v.allCustomEnvs,
        id: existing.id || v.id,
      })
    }
  })

  const missingVars: string[] = []
  const missingTargets: string[] = []

  sharedVarNames.forEach((key) => {
    const entry = remoteMap.get(key)
    if (!entry) {
      missingVars.push(key)
      return
    }
    const targets = entry.target || []
    const hasProduction = targets.includes('production')
    const hasNonProd =
      entry.allCustomEnvs === true ||
      targets.some((t) => t !== 'production') ||
      targets.includes('preview') ||
      targets.includes('development')
    if (!hasProduction || !hasNonProd) {
      const targetLabel =
        hasProduction && !hasNonProd
          ? 'non-production'
          : !hasProduction && hasNonProd
            ? 'production'
            : 'production/non-production'
      missingTargets.push(`${key} (missing ${targetLabel} target)`)
    }
  })

  const proposedChanges: string[] = []
  const fatalMissingLocal: string[] = []
  const plannedActions: PlannedAction[] = []

  if (missingVars.length === 0 && missingTargets.length === 0) {
    reporter.printInfo('All shared env vars are configured for production and non-production')
  } else {
    if (missingVars.length > 0) {
      reporter.printWarning(`Missing shared env vars in Vercel team: ${missingVars.join(', ')}`)
    }
    if (missingTargets.length > 0) {
      reporter.printWarning(`Shared env vars missing required targets: ${missingTargets.join(', ')}`)
    }

    missingVars.forEach((key) => {
      const localVal = rootLocal.get(key)
      if (!localVal) {
        fatalMissingLocal.push(
          `Shared var ${key} missing remotely and no local value. Run "pnpm env-vars-doctor" first.`
        )
      }
      proposedChanges.push(`Shared: add ${key} with targets production + preview/development`)
      plannedActions.push({
        kind: 'create-shared',
        key,
        value: localVal || '',
        targets: ['preview', 'development'],
        allCustomEnvs: true,
      })
      plannedActions.push({
        kind: 'create-shared',
        key,
        value: localVal || '',
        targets: ['production'],
        promptValue: true,
      })
    })

    missingTargets.forEach((entry) => {
      const key = entry.split(' (')[0]
      proposedChanges.push(`Shared: update ${key} to include production + preview/development targets`)
      const remote = remoteMap.get(key)
      if (remote?.id) {
        const mergedTargets = Array.from(
          new Set([...(remote.target || []), 'production', 'preview', 'development'])
        )
        plannedActions.push({
          kind: 'update-shared-targets',
          id: remote.id,
          key,
          targets: mergedTargets,
          allCustomEnvs: remote.allCustomEnvs,
        })
      }
    })
  }

  // App-specific (project-level) check
  console.log('\n🔍 Checking app-specific env vars for apps with Vercel project IDs...')

  // Read project IDs from workflow or plugin config
  const workflowPath = path.join(rootDir, '.github/workflows/deploy-production.yml')
  const projectMap = parseProjectMappingFromWorkflow(workflowPath)

  if (projectMap.size === 0) {
    reporter.printWarning('No project IDs found in deploy-production workflow; skipping app-specific checks')
    if (fatalMissingLocal.length > 0) {
      reporter.printError('Cannot proceed: some missing env vars have no local value.')
      fatalMissingLocal.forEach((msg) => reporter.printError(`- ${msg}`))
      return 1
    }
    return proposedChanges.length > 0 ? 1 : 0
  }

  // Get apps with project IDs
  const allApps = await scanWorkspaces(config, rootDir)
  const apps = allApps.filter((a) => projectMap.has(a.name) && hasEnvExample(a))

  if (apps.length === 0) {
    reporter.printWarning('No apps with project IDs found; skipping app-specific checks')
  } else {
    const appIssues: string[] = []
    const appProposed: string[] = []

    for (const appInfo of apps) {
      const projectId = projectMap.get(appInfo.name)!
      const appEnvExamplePath = appInfo.envExamplePath
      const appSchema = parseEnvExample(appEnvExamplePath)

      // App-specific vars are those not in shared list
      const appSpecificVars = appSchema.variables
        .filter((v) => !sharedVarNames.includes(v.name))
        .map((v) => v.name)

      if (appSpecificVars.length === 0) {
        continue
      }

      const appLocal = fs.existsSync(appInfo.envLocalPath)
        ? parseEnvLocal(appInfo.envLocalPath).values
        : new Map<string, string>()

      let projectVars: RemoteVar[] = []
      try {
        projectVars = await fetchProjectEnvVars(token, teamId, projectId)
      } catch (error) {
        appIssues.push(
          `${appInfo.name}: failed to fetch project env vars (${error instanceof Error ? error.message : 'unknown error'})`
        )
        continue
      }

      const projectMapVars = new Map<string, { target: string[]; allCustomEnvs?: boolean }>()
      projectVars.forEach((v) => {
        if (!projectMapVars.has(v.key)) {
          projectMapVars.set(v.key, { target: v.target, allCustomEnvs: v.allCustomEnvs })
        } else {
          const existing = projectMapVars.get(v.key)!
          const merged = Array.from(new Set([...(existing.target || []), ...v.target]))
          projectMapVars.set(v.key, {
            target: merged,
            allCustomEnvs: existing.allCustomEnvs || v.allCustomEnvs,
          })
        }
      })

      const missingAppVars: string[] = []
      const missingTargetsApp: string[] = []

      appSpecificVars.forEach((key) => {
        const entry = projectMapVars.get(key) || remoteMap.get(key)
        if (!entry) {
          missingAppVars.push(key)
          return
        }
        const targets = entry.target || []
        const hasProduction = targets.includes('production')
        const hasNonProd =
          entry.allCustomEnvs === true ||
          targets.some((t) => t !== 'production') ||
          targets.includes('preview') ||
          targets.includes('development')
        if (!hasProduction || !hasNonProd) {
          const targetLabel =
            hasProduction && !hasNonProd
              ? 'non-production'
              : !hasProduction && hasNonProd
                ? 'production'
                : 'production/non-production'
          missingTargetsApp.push(`${key} (missing ${targetLabel} target)`)
        }
      })

      if (missingAppVars.length === 0 && missingTargetsApp.length === 0) {
        reporter.printInfo(
          `✅ ${appInfo.name}: app-specific env vars configured for production and non-production`
        )
      } else {
        if (missingAppVars.length > 0) {
          missingAppVars.forEach((key) => {
            const localVal = appLocal.get(key) || rootLocal.get(key)
            if (!localVal) {
              fatalMissingLocal.push(
                `${appInfo.name}: ${key} missing remotely and no local value. Run "pnpm env-vars-doctor --app=${appInfo.name}" first.`
              )
            }
            appProposed.push(`${appInfo.name}: add ${key} with targets production + preview/development`)
            plannedActions.push({
              kind: 'create-project',
              projectId,
              projectName: appInfo.name,
              key,
              value: localVal || '',
              targets: ['preview', 'development'],
              allCustomEnvs: true,
            })
            plannedActions.push({
              kind: 'create-project',
              projectId,
              projectName: appInfo.name,
              key,
              value: localVal || '',
              targets: ['production'],
              promptValue: true,
            })
          })
          appIssues.push(`${appInfo.name}: missing app-specific env vars: ${missingAppVars.join(', ')}`)
        }
        if (missingTargetsApp.length > 0) {
          missingTargetsApp.forEach((entry) => {
            const key = entry.split(' (')[0]
            appProposed.push(
              `${appInfo.name}: update ${key} to include production + preview/development targets`
            )
          })
          appIssues.push(
            `${appInfo.name}: app-specific env vars missing targets: ${missingTargetsApp.join(', ')}`
          )
        }
      }
    }

    if (appIssues.length > 0) {
      reporter.printWarning('App-specific env var issues:')
      appIssues.forEach((issue) => reporter.printWarning(`- ${issue}`))
    }

    proposedChanges.push(...appProposed)
  }

  if (fatalMissingLocal.length > 0) {
    reporter.printError(
      'Cannot proceed: some missing env vars have no local value. Run "pnpm env-vars-doctor" first.'
    )
    fatalMissingLocal.forEach((msg) => reporter.printError(`- ${msg}`))
    return 1
  }

  if (proposedChanges.length > 0) {
    console.log('\nPlanned changes:')
    proposedChanges.forEach((change) => console.log(`- ${change}`))

    if (dryRun) {
      reporter.printInfo('Dry run mode - no changes applied.')
      return 0
    }

    // Ask for confirmation
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const confirmed = await new Promise<boolean>((resolve) => {
      rl.question('\nProceed with applying these changes? (y/N): ', (answer) => {
        const normalized = answer.trim().toLowerCase()
        rl.close()
        resolve(normalized === 'y' || normalized === 'yes')
      })
    })

    if (!confirmed) {
      reporter.printInfo('No changes were made (confirmation declined).')
      return 0
    }

    try {
      if (plannedActions.length > 0) {
        await applyPlannedActions(plannedActions, token, teamId)
        reporter.printInfo('Changes applied successfully.')
      } else {
        reporter.printInfo('Nothing to apply.')
      }
    } catch (error) {
      reporter.printError(error instanceof Error ? error.message : 'Failed to apply changes')
      return 1
    }
  } else {
    reporter.printInfo('All shared and app-specific env vars are configured for production and non-production')
  }

  return 0
}
