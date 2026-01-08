# env-vars-doctor

Environment variable management for projects and monorepos - sync, validate, and diagnose `.env` files.

## Features

- **Schema-based validation** - Define environment variables with directives in `.env.local.example` files
- **Works everywhere** - Supports both single projects and monorepos with multiple workspaces
- **Interactive prompts** - Guided setup for missing values
- **Source code scanning** - Detect undocumented `process.env` usage
- **CI integration** - Validate environment completeness in pipelines
- **Plugin architecture** - Extend with custom value sources and integrations

## Installation

```bash
npm install env-vars-doctor
# or
pnpm add env-vars-doctor
# or
yarn add env-vars-doctor
```

## Quick Start

1. Create a `.env.local.example` file with your schema:

```bash
# [required] [prompt] Database connection string
DATABASE_URL=

# [optional] [default:3000] Server port
PORT=3000

# [required] [boolean] Enable debug mode
DEBUG=false
```

2. Run sync to create your `.env.local`:

```bash
npx env-vars-doctor sync
```

3. Check status anytime:

```bash
npx env-vars-doctor status
```

## Schema Directives

Add directives in comments above variables:

| Directive | Description |
|-----------|-------------|
| `[required]` | Variable must have a value |
| `[optional]` | Variable can be empty |
| `[prompt]` | Interactively prompt for value |
| `[default:value]` | Use default if not set |
| `[boolean]` | Yes/no prompt (true/false) |
| `[boolean:yes/no]` | Boolean with custom values |
| `[copy:VAR]` | Copy value from another variable |
| `[computed:type]` | Generate value (e.g., `computed:port`) |
| `[local-only]` | Skip in CI/deployment contexts |

### Example Schema

```bash
# =============================================================================
# Database Configuration
# =============================================================================

# [required] [prompt] PostgreSQL connection URL
DATABASE_URL=

# [optional] [default:5432] Database port
DB_PORT=5432

# =============================================================================
# Authentication
# =============================================================================

# [required] [prompt] Auth provider API key
AUTH_API_KEY=

# [required] [copy:AUTH_API_KEY] Duplicate for legacy support
LEGACY_AUTH_KEY=

# =============================================================================
# Development
# =============================================================================

# [optional] [boolean] Enable verbose logging
VERBOSE=false

# [local-only] [default:true] Hot reload in development
HOT_RELOAD=true
```

## Commands

### `sync`

Create or update `.env.local` files from schema:

```bash
env-vars-doctor sync              # Sync current app
env-vars-doctor sync --all        # Sync all workspaces
env-vars-doctor sync --force      # Overwrite existing values
```

### `status`

Show environment variable status:

```bash
env-vars-doctor status            # Current app status
env-vars-doctor status --all      # All workspaces
```

### `check`

Validate environment without prompts:

```bash
env-vars-doctor check             # Exit 1 if issues found
env-vars-doctor check --ci        # CI-optimized output
```

### `diagnose`

Scan source code for environment issues:

```bash
env-vars-doctor diagnose          # Find undocumented env vars
env-vars-doctor diagnose --fix    # Add missing to schema
```

### `clean`

Remove generated `.env.local` files:

```bash
env-vars-doctor clean             # Current app
env-vars-doctor clean --all       # All workspaces
```

### `export`

Export variables for deployment:

```bash
env-vars-doctor export --format=vercel   # Vercel format
env-vars-doctor export --format=shell    # Shell export format
env-vars-doctor export --format=json     # JSON format
```

## Configuration

Create `env-vars-doctor.config.ts` (or `.js`, `.json`, `.env-vars-doctorrc`):

```typescript
import { defineConfig } from 'env-vars-doctor'

export default defineConfig({
  project: {
    rootEnvExample: '.env.local.example',
    rootEnvLocal: '.env.local',
    workspaces: {
      detection: 'pnpm',  // 'auto' | 'pnpm' | 'npm' | 'yarn' | 'manual'
      patterns: ['apps/*', 'packages/*'],
      portDetection: {
        method: 'static',
        staticPorts: {
          'web': 3000,
          'api': 3001,
          'admin': 3002,
        },
      },
    },
  },
  scanning: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    skipDirs: ['node_modules', 'dist', '.next'],
    ignoreMissing: ['NODE_ENV', 'CI', 'VERCEL'],
    ignoreUnused: ['LEGACY_VAR'],
  },
  ci: {
    skipEnvVar: 'SKIP_ENV_DOCTOR',
    skipDirectives: ['local-only', 'prompt'],
  },
})
```

## Plugins

### Built-in Plugins

#### Supabase Plugin

Auto-fetch keys from local Supabase:

```typescript
import { defineConfig } from 'env-vars-doctor'

export default defineConfig({
  plugins: {
    supabase: {
      enabled: true,
      databaseDir: 'packages/database',
      variableMapping: {
        'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'anon_key',
        'SUPABASE_SERVICE_ROLE_KEY': 'service_role_key',
      },
    },
  },
})
```

Then use in schema:

```bash
# [required] [supabase] Supabase anon key
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

#### Vercel Plugin

Deploy environment variables to Vercel:

```typescript
import { defineConfig } from 'env-vars-doctor'

export default defineConfig({
  plugins: {
    vercel: {
      enabled: true,
      projectMapping: {
        'web': 'my-web-project',
        'api': 'my-api-project',
      },
    },
  },
})
```

```bash
env-vars-doctor deploy --target=production
```

### Custom Plugins

Create custom value sources:

```typescript
import type { EnvDoctorPlugin, ValueSourceProvider } from 'env-vars-doctor/plugins'

const myPlugin: EnvDoctorPlugin = {
  meta: {
    name: 'my-plugin',
    version: '1.0.0',
  },
  sources: [
    {
      directiveType: 'vault',
      pattern: /\[vault(?::([^\]]+))?\]/i,
      resolve: async (definition, context) => {
        const secret = await fetchFromVault(definition.key)
        return { value: secret, source: 'vault' }
      },
      isAvailable: () => !!process.env.VAULT_TOKEN,
      unavailableMessage: 'Vault token not configured',
    },
  ],
}

export default myPlugin
```

## Programmatic API

```typescript
import { EnvDoctor, loadConfig } from 'env-vars-doctor'

const config = await loadConfig()
const doctor = new EnvDoctor(config)

// Parse schema
const schema = await doctor.parseSchema('.env.local.example')

// Scan workspaces
const apps = await doctor.scanWorkspaces()

// Reconcile differences
const diff = await doctor.reconcile(schema, currentEnv)

// Generate report
const report = doctor.report(diff)
```

## CI Integration

### GitHub Actions

```yaml
- name: Validate environment
  run: npx env-vars-doctor check --ci
  env:
    CI: true
```

### Skip in CI

Set `SKIP_ENV_DOCTOR=1` to skip validation:

```yaml
env:
  SKIP_ENV_DOCTOR: 1
```

## License

MIT
