# Workflow

## Build Commands

- `npm start`: Run in development mode (Electron Forge + Vite HMR)
- `npm run package`: Package the app for the current platform
- `npm run make`: Build distributable installers (Squirrel, ZIP, RPM, DEB)
- `npm run check`: Lint and type-check via Ultracite (Biome)
- `npm run fix`: Auto-fix lint issues
- `npm test`: Run unit tests (Vitest)
- `npm run test:e2e`: Run end-to-end tests (Playwright)

Don't build after every change. If `npm run check` passes, assume changes work.

## Development Workflow

1. Run `npm start` to launch the app in dev mode with hot reload.
2. The renderer uses Vite dev server with HMR — UI changes reflect instantly.
3. Main process changes require a restart (`npm start` again).
4. After making changes, run `npm run check` to verify types and lint.

## Testing

- **Unit tests**: Vitest with jsdom, files under `src/tests/unit/`.
- **E2E tests**: Playwright with Chromium, files under `src/tests/e2e/`.
- Run all: `npm run test:all`.

## Formatting

Biome via Ultracite handles formatting and linting. Run `npm run fix` to auto-fix.
