# Electron Patterns

## Process Architecture

| Process | Entry | Role |
|---------|-------|------|
| Main | `src/main.ts` | App lifecycle, BrowserWindow, custom protocol, oRPC server |
| Preload | `src/preload.ts` | MessagePort bridge between renderer and main |
| Renderer | `src/renderer.ts` → `src/app.tsx` | React UI, oRPC client |

## Custom Protocol (`local-file://`)

The renderer runs on a Vite dev server (`http://localhost`) during development, which blocks `file://` resources. A custom protocol serves local files in both dev and production.

### Important implementation details

1. **Scheme registration must happen at module scope** in `src/main.ts`, before `app.ready`:

```typescript
protocol.registerSchemesAsPrivileged([{
  scheme: "local-file",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);
```

2. **The handler uses `fs.readFile`** (not `net.fetch`) — `net.fetch("file://...")` had reliability issues:

```typescript
protocol.handle("local-file", async (request) => {
  const url = new URL(request.url);
  const filePath = decodeURIComponent(url.pathname);
  const data = await fs.promises.readFile(filePath);
  return new Response(data, { headers: { "Content-Type": mimeType } });
});
```

3. **URLs must include `localhost` as the host**:
   - Correct: `local-file://localhost/Users/foo/segment.png`
   - Wrong: `local-file:///Users/foo/segment.png` — Chromium eats `Users` as the hostname

Use the shared `toLocalFileUrl()` helper from `src/components/webtoon/types.ts`.

## Native Modules (Sharp)

Sharp is a C++ addon and requires special handling:

1. **Externalized from Vite** in `vite.main.config.mts`:
   ```typescript
   build: { rollupOptions: { external: ["sharp"] } }
   ```

2. **Unpacked from ASAR** by `@electron-forge/plugin-auto-unpack-natives` in `forge.config.ts`. Without this, Sharp's `.node` binaries would be trapped inside the ASAR archive and fail to load.

3. **Only imported in the main process** — Sharp runs in `src/ipc/webtoon/processor.ts`, never in the renderer.

### Adding other native modules

Follow the same pattern: externalize in `vite.main.config.mts`, ensure auto-unpack-natives is in `forge.config.ts` plugins.

## Window Configuration

- Size: 1000x800 (set in `createWindow()` in `src/main.ts`)
- Hidden title bar with custom `DragWindowRegion` component for window dragging
- macOS: `titleBarStyle: "hiddenInset"` with traffic lights at `{ x: 5, y: 5 }`
- Other platforms: `titleBarStyle: "hidden"` with custom window control buttons

## Packaging

Electron Forge handles packaging and distribution:

- **Squirrel** (Windows installer)
- **ZIP** (macOS)
- **RPM** + **DEB** (Linux)

Fuses are configured for security: ASAR integrity, cookie encryption, no `NODE_OPTIONS`, no `RunAsNode`.

## Preload Script

The preload (`src/preload.ts`) is minimal — it only bridges a MessagePort for oRPC. It does NOT use `contextBridge.exposeInMainWorld`. All IPC flows through the oRPC client in the renderer.

## Vite Configuration

Three separate Vite configs, each used by Electron Forge's VitePlugin:

| Config | Target | Notes |
|--------|--------|-------|
| `vite.main.config.mts` | Main process | Externalizes `sharp`, `@` alias |
| `vite.preload.config.mts` | Preload | Default config |
| `vite.renderer.config.mts` | Renderer | React, Tailwind, TanStack Router, Babel React Compiler |
