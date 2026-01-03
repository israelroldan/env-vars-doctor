# Improvements Tracker

## Completed

- [x] Version reads from package.json instead of hardcoded
- [x] Add `--dry-run` flag for deploy command
- [x] Add `--quiet` flag for status command
- [x] Add sandbox monorepo fixture for testing
- [x] Add release-please for automated releases
- [x] Use npm trusted publishing (OIDC)
- [x] Add CONTRIBUTING.md

## Quick Wins

- [ ] Add CI workflow for PRs (run `type-check` and `build` on pull requests)
- [ ] Add `homepage` and `bugs` fields to package.json
- [ ] Add ESLint config (currently `pnpm lint` fails - no eslint installed)

## Larger Improvements

- [ ] Add unit tests (vitest)
- [ ] Switch to a CLI framework (e.g., `citty`, `cleye`) for better subcommand help and validation
- [ ] Add `init` command to scaffold config files
- [ ] Subcommand-specific help (e.g., `env-vars-doctor sync --help`)
