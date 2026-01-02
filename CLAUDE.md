# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
pnpm build          # Build with tsup (ESM + CJS output)
pnpm dev            # Watch mode for development
pnpm type-check     # TypeScript type checking (tsc --noEmit)
pnpm lint           # ESLint on src/
```

## Architecture Overview

env-vars-doctor is a CLI tool for managing environment variables across monorepos. It parses `.env.local.example` schema files with directive comments and syncs them to `.env.local` files.

### Entry Points
- `src/cli.ts` - CLI entry point with argument parsing and command dispatch
- `src/index.ts` - Library exports for programmatic use
- `bin/env-vars-doctor.js` - Node executable wrapper

### Core Modules (`src/core/`)
- `parser.ts` - Parses `.env.example` files, extracting directives from comments (e.g., `[required]`, `[prompt]`, `[default:value]`)
- `scanner.ts` - Detects monorepo workspaces using pnpm/npm/yarn workspace configs
- `source-scanner.ts` - Scans source code for `process.env` usage to find undocumented or unused variables
- `reconciler.ts` - Compares schema definitions against actual `.env.local` values
- `config.ts` - Configuration loading via cosmiconfig (supports `.ts`, `.js`, `.json`, `.env-vars-doctorrc`)
- `reporter.ts` - Terminal output formatting
- `types.ts` - All TypeScript interfaces and types

### Value Sources (`src/sources/`)
Each module handles a specific directive type:
- `prompt.ts` - Interactive user prompts for `[prompt]` directive
- `boolean.ts` - Yes/no prompts for `[boolean]` directive
- `computed.ts` - Generated values (e.g., port numbers) for `[computed]` directive
- `copy.ts` - Copy values from other variables for `[copy:VAR]` directive
- `local-only.ts` - Variables skipped in CI for `[local-only]` directive

### Plugin System (`src/plugins/`)
- `types.ts` - Plugin interface definitions (exported as `env-vars-doctor/plugins`)
- `registry.ts` - Plugin registration and lifecycle hook management
- `loader.ts` - Loads built-in and external plugins from config

### Built-in Plugins (`src/builtin-plugins/`)
- `supabase/` - Fetches keys from local Supabase
- `vercel/` - Deploys env vars to Vercel

### Commands (`src/commands/`)
Each command is a separate module: `sync.ts`, `status.ts`, `check.ts`, `diagnose.ts`, `clean.ts`, `ci.ts`, `export.ts`, `deploy.ts`, `postinstall.ts`

## Testing

A `sandbox/` directory contains a mock monorepo for manual testing:

```bash
cd sandbox
node ../bin/env-vars-doctor.js status     # Show missing variables
node ../bin/env-vars-doctor.js diagnose   # Find undocumented env vars
node ../bin/env-vars-doctor.js sync       # Interactive sync flow
node ../bin/env-vars-doctor.js --help     # CLI help
```

The sandbox includes two apps (`web`, `api`), a shared package (`database`), and intentionally has an undocumented `SECRET_FEATURE_FLAG` variable for testing `diagnose`.

## Key Patterns

- ESM-first with CJS build output (dual format via tsup)
- Uses `@/*` path alias mapping to `./src/*`
- Directive parsing: comments above env vars are parsed for bracketed directives like `[required]`, `[prompt]`, `[default:value]`
- Plugin sources extend directive handling by registering new patterns via `ValueSourceProvider`

## Release Process

Uses [release-please](https://github.com/googleapis/release-please) for automated releases:

1. Commits to `main` must follow [Conventional Commits](https://www.conventionalcommits.org/) format:
   - `feat:` for new features (triggers minor version bump)
   - `fix:` for bug fixes (triggers patch version bump)
   - `feat!:` or `BREAKING CHANGE:` for breaking changes (triggers major version bump)
2. Release-please automatically creates/updates a Release PR with changelog
3. Merging the Release PR triggers npm publish via GitHub Actions

Uses npm trusted publishing (OIDC) - no secrets required. Configure trusted publisher on npmjs.com with workflow `release.yml`.
