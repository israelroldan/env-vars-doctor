# Contributing

## Development

```bash
pnpm install
pnpm dev        # Watch mode
pnpm build      # Build
pnpm type-check # Type check
```

## Testing

Use the `sandbox/` directory to test CLI commands:

```bash
cd sandbox
node ../bin/env-vars-doctor.js status
node ../bin/env-vars-doctor.js diagnose
node ../bin/env-vars-doctor.js sync
```

## Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `test:` tests
- `refactor:` code changes that don't fix bugs or add features

## Pull Requests

1. Fork and create a branch
2. Make your changes
3. Ensure `pnpm build && pnpm type-check` passes
4. Submit PR against `main`
