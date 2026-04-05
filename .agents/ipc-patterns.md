# IPC Patterns

## Architecture Overview

This app uses **oRPC over MessagePort** for all renderer-to-main communication. There are no `ipcMain.handle` / `ipcRenderer.invoke` calls — everything flows through a typed RPC client.

```
React component
  → src/actions/webtoon.ts          (thin action wrappers)
  → src/ipc/manager.ts              (oRPC client via RPCLink)
  → preload.ts                      (MessagePort bridge)
  → src/main.ts                     (receives port, upgrades RPCHandler)
  → src/ipc/webtoon/handlers.ts     (oRPC handlers)
  → src/ipc/webtoon/processor.ts    (Sharp image processing)
```

## Adding a New Handler

Follow this checklist when adding a new IPC handler:

### 1. Define the Zod schema (`src/ipc/webtoon/schemas.ts`)

```typescript
export const myNewInputSchema = z.object({
  param: z.string(),
});
```

### 2. Create the handler (`src/ipc/webtoon/handlers.ts`)

```typescript
export const myNewHandler = os
  .input(myNewInputSchema)
  .handler(async ({ input }) => {
    // Main process logic here
    return { result: "value" };
  });
```

If the handler needs the `BrowserWindow` (e.g., for dialogs), use the context middleware:

```typescript
export const myNewHandler = os
  .use(ipcContext.mainWindowContext)
  .handler(async ({ context }) => {
    const res = await dialog.showOpenDialog(context.window, { ... });
    return res;
  });
```

### 3. Register in the namespace index (`src/ipc/webtoon/index.ts`)

```typescript
import { myNewHandler } from "./handlers";

export const webtoon = {
  // ...existing handlers
  myNewHandler,
};
```

### 4. Create the action wrapper (`src/actions/webtoon.ts`)

```typescript
export function myNewAction(payload: { param: string }) {
  return ipc.client.webtoon.myNewHandler(payload);
}
```

### 5. Update documentation

Add the new handler to the oRPC Router table and Webtoon Handlers table in `docs/APP.md`.

## oRPC Router Structure

The router aggregates handler namespaces in `src/ipc/router.ts`:

| Namespace | Purpose |
|-----------|---------|
| `webtoon` | Core app: folder pickers, process, split, merge, showInFolder |
| `app` | App info: platform, version |
| `shell` | External links |
| `theme` | Native theme mode |
| `window` | Window controls: minimize, maximize, close |

## Context Middleware

`ipcContext.mainWindowContext` (from `src/ipc/context.ts`) injects the main `BrowserWindow` into the handler context. Required for:

- `dialog.showOpenDialog()` — needs parent window to show as modal sheet on macOS
- Any handler that needs to interact with the main window

## Key Conventions

- **Handlers run in the main process** — they have full access to Node.js, Electron APIs, and native modules like Sharp.
- **Actions are renderer-side** — they're thin wrappers that relay calls through the oRPC client. Don't put business logic in actions.
- **Schemas validate at the boundary** — oRPC validates inputs automatically via Zod before the handler runs.
- **Return plain serializable objects** — oRPC serializes return values over MessagePort. No class instances, Buffers, or circular references.
