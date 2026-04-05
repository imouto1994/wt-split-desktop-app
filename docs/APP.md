# Webtoon Stitch & Split — Implementation & Specification

## Purpose

Desktop application that stitches ordered chapter images into one vertical strip, removes large uniform vertical gaps (blank / single-color bands), exports PNG segments to a folder, and optionally splits oversized segments manually via a visual multi-line editor. The image pipeline uses [Sharp](https://sharp.pixelplumbing.com/).

This app is a rebuild of the earlier VanillaJS prototype (`webtoon-prototype/electron/`) using a modern stack with React, TypeScript, Tailwind, and oRPC-based IPC. It extends the prototype with multi-breakpoint splitting, undo/merge, and aspect-ratio-based edit triggers.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Electron ~v41 |
| Build / Bundle | Electron Forge + Vite 8 |
| Main process | TypeScript, Node 22+ APIs |
| IPC | [oRPC](https://orpc.unnoq.com/) over MessagePort |
| Image I/O | [Sharp](https://sharp.pixelplumbing.com/) |
| UI framework | React 19 |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Routing | TanStack Router (file-based) |
| Validation | Zod 4 |
| Lint / Format | Biome via Ultracite |
| Testing | Vitest (unit) + Playwright (e2e) |
| Packaging | Electron Forge (Squirrel, ZIP, RPM, DEB) |

## Repository Layout

```
src/
  main.ts                     # App lifecycle, BrowserWindow, custom protocol, oRPC setup
  preload.ts                  # MessagePort bridge for oRPC
  renderer.ts                 # Entry point → imports app.tsx
  app.tsx                     # React root, RouterProvider, theme/language sync
  constants/index.ts          # IPC channel names, env vars, feature flags
  ipc/
    handler.ts                # RPCHandler wrapping the router
    manager.ts                # Renderer-side oRPC client (IPCManager)
    context.ts                # MainWindow context middleware for oRPC handlers
    router.ts                 # Top-level oRPC router aggregating all namespaces
    webtoon/
      processor.ts            # Image stitching, gap detection, segment I/O, multi-split, merge
      handlers.ts             # oRPC handlers: pickInput, pickOutput, processWebtoon,
                              #   writeMetadata, splitSegment, mergeSegments, showInFolder
      schemas.ts              # Zod input schemas
      index.ts                # Composes handlers into the webtoon namespace
    app/                      # App info handlers (platform, version)
    shell/                    # External link handler
    theme/                    # Theme mode handlers
    window/                   # Window control handlers (minimize, maximize, close)
  actions/
    webtoon.ts                # Renderer-side wrappers calling ipc.client.webtoon.*
    app.ts / shell.ts / ...   # Other action wrappers
  routes/
    __root.tsx                # Root layout with DragWindowRegion
    index.tsx                 # Main page: webtoon processor UI
  components/
    webtoon/
      types.ts                # SegmentMeta (paths, dimensions, splitGroup, gap colors) + toLocalFileUrl
      folder-picker.tsx       # Button + path display
      status-display.tsx      # Colored status text
      segment-list.tsx        # Ordered list of segment paths and heights
      segment-grid.tsx        # Responsive thumbnail grid with Open / Edit / Undo
      split-editor-modal.tsx  # Multi-line split editor modal
    ui/                       # shadcn/ui primitives (button, toggle, etc.)
    drag-window-region.tsx    # Custom title bar drag region
  layouts/
    base-layout.tsx           # DragWindowRegion + scrollable <main>
  styles/global.css           # Tailwind 4 imports, theme variables
  localization/               # i18next setup (en, pt-BR)
```

Build configuration lives at the repo root:

| File | Purpose |
|------|---------|
| `forge.config.ts` | Electron Forge: makers, publishers, Vite plugin, Fuses, auto-unpack-natives |
| `vite.main.config.mts` | Vite for main process (externalizes `sharp`) |
| `vite.preload.config.mts` | Vite for preload |
| `vite.renderer.config.mts` | Vite for renderer (React, Tailwind, TanStack Router) |
| `tsconfig.json` | Strict TypeScript, `@/*` path alias |

## How to Run

```bash
npm install
npm start
```

For production packaging:

```bash
npm run make
```

---

## Functional Specification

### Input

- **Input folder**: User-selected directory via native OS dialog.
- **Accepted extensions**: `.png`, `.jpg`, `.jpeg`, `.webp` (case-insensitive).
- **Order**: Files are sorted by basename using numeric-aware `localeCompare` so `2.png` sorts before `10.png`.

### Output

- **Output folder**: User may choose explicitly; if omitted, defaults to `<inputDir>/images_output`.
- **Pre-run behavior**: The output directory is deleted and recreated on each full "Process" run.
- **Segment files**: `segment_000.png`, `segment_001.png`, ... zero-padded to three digits.
- **Sidecar**: `metadata.json` is written alongside the segment PNGs. It holds per-segment gap color metadata (`topGapColor`, `bottomGapColor`) for the web app’s admin upload flow. The file is created/updated by the processor after a full process run and kept in sync after manual split/merge via the `writeMetadata` handler.

### Stitching

1. For each source file, Sharp reads metadata. EXIF orientation is accounted for (orientations 5-8 swap width/height).
2. Each image is auto-rotated (`.rotate()`) then resized to a common target width: the maximum width among all oriented inputs. Height scales proportionally.
3. Frames are composited top-to-bottom on a transparent RGBA canvas.

### Gap Removal (Automatic Splitting)

1. The stitched image is rendered to a PNG buffer, then re-opened as a Sharp pipeline.
2. Raw RGBA pixels are scanned row-by-row.
3. A row is "uniform" if every pixel matches the first pixel within `COLOR_TOLERANCE` per channel (R, G, B, A).

Constants in `src/ipc/webtoon/processor.ts`:

- `COLOR_TOLERANCE = 10`
- `MIN_GAP_HEIGHT = 100` — contiguous runs of uniform rows at least this tall are treated as removable gaps; content between those runs becomes segments.

### Manual Segment Split (Editor)

- **Trigger**: Segments with **height/width ratio greater than 3** show an "Edit" button in the grid (`EDIT_ASPECT_RATIO_THRESHOLD = 3` in `segment-grid.tsx`).
- **Multi-line editor**: Modal with the full segment image in a scrollable area. Supports **multiple split lines** — the user can split a segment into 2, 3, or more sub-segments at once.
  - **Default**: Opens with 1 split line at **50% height** of the segment.
  - **Add line**: "Add" button places a new line in the largest gap between existing lines.
  - **Remove line**: Minus icon on each handle removes that line. At least 1 line must remain.
  - **Drag**: Each line is independently draggable. A 24px invisible hit area makes grabbing easy. Each line has a distinct color (emerald, sky, amber, rose, violet, orange) to distinguish them.
  - **Pixel readout**: Each handle badge shows the approximate pixel position from the top.
- **Save**: Calls `splitSegment` with `{ filePath, breakpoints: number[] }` (array of pixel positions, sorted and clamped).
- **Disk effect**:
  - N+1 new files: `<basename>_<timestamp>_a<ext>`, `..._b`, `..._c`, etc. in the same directory.
  - The original file is deleted after successful split.
- **Gap colors after split**: Child segments inherit gap colors from the parent: the **first** child keeps the parent’s `topGapColor`, the **last** child keeps the parent’s `bottomGapColor`, and **middle** children get `null` for both (or the appropriate null for interior boundaries). After split, **`writeMetadata`** is invoked so `metadata.json` stays aligned with the new files.
- **UI refresh**: The in-memory segment list removes the old path and appends metadata for all new files; the grid re-sorts by path (numeric-aware). All new sub-segments share a `splitGroup` ID.

### Undo / Merge

- After a split, all resulting sub-segments are tagged with a shared `splitGroup` ID in the renderer state.
- Each sub-segment shows an amber **"Undo split (merge group)"** button in the grid.
- Clicking it on any member merges **all** members of that group back into a single file by vertically stitching them.
- The merge writes a new `merged_<timestamp>.png` file in the same directory and deletes the individual sub-segment files.
- **Gap colors after merge**: The merged segment’s `topGapColor` comes from the **first** child’s `topGapColor`, and `bottomGapColor` from the **last** child’s `bottomGapColor`. After merge, **`writeMetadata`** updates `metadata.json` for the output directory.

### Preview & Listing

- **List**: Shows each absolute path and decoded height (px).
- **Grid**: Lazy-loaded thumbnails via `local-file://localhost/...` protocol, index + height.
- **Open**: Calls `shell.showItemInFolder()` to reveal the file in the OS file manager (Finder / Explorer).
- **Edit**: Opens the multi-line split editor (when aspect ratio threshold is met).
- **Undo**: Merges a split group back (when the segment has a `splitGroup`).
- After splits, filenames may no longer follow strict `segment_XXX.png` ordering; sorting is by full path string (numeric-aware).

---

## Architecture

### IPC via oRPC

This app uses oRPC over MessagePort for all main-renderer communication:

```
React component
  → src/actions/webtoon.ts
  → src/ipc/manager.ts (oRPC client via RPCLink over MessagePort)
  → preload.ts (bridges MessagePort to main process via ipcRenderer.postMessage)
  → src/main.ts (receives port, upgrades RPCHandler)
  → src/ipc/webtoon/handlers.ts (oRPC handlers)
  → src/ipc/webtoon/processor.ts (Sharp)
```

### oRPC Router (`src/ipc/router.ts`)

Aggregates all handler namespaces:

| Namespace | Handlers |
|-----------|----------|
| `webtoon` | `pickInput`, `pickOutput`, `processWebtoon`, `writeMetadata`, `splitSegment`, `mergeSegments`, `showInFolder` |
| `app` | `currentPlatfom`, `appVersion` |
| `shell` | `openExternalLink` |
| `theme` | `getCurrentThemeMode`, `toggleThemeMode`, `setThemeMode` |
| `window` | `minimizeWindow`, `maximizeWindow`, `closeWindow` |

### Webtoon Handlers (`src/ipc/webtoon/handlers.ts`)

| Handler | What it does |
|---------|-------------|
| `pickInput` | `dialog.showOpenDialog(window, { properties: ["openDirectory"] })` — returns path or null |
| `pickOutput` | `dialog.showOpenDialog(window, { properties: ["openDirectory", "createDirectory"] })` — returns path or null |
| `processWebtoon` | Resolves `outputDir` default, calls `processor.processWebtoon()`, returns `{ outputDir, segments }` (each segment includes path + gap colors) |
| `writeMetadata` | Takes `{ outputDir, segments: { filename, topGapColor, bottomGapColor }[] }`, writes or overwrites `metadata.json` in that directory (used after split/merge to keep the sidecar in sync) |
| `splitSegment` | Takes `{ filePath, breakpoints: number[] }`, calls `processor.splitSegment()`, returns `{ files }` (N+1 paths) |
| `mergeSegments` | Takes `{ filePaths, outputPath }`, calls `processor.mergeSegments()`, returns `{ file }` (merged path) |
| `showInFolder` | Calls `shell.showItemInFolder(filePath)` to reveal a file in the OS file manager |

The `pickInput` and `pickOutput` handlers use the `ipcContext.mainWindowContext` middleware to attach the native dialog to the main `BrowserWindow`.

### Processor (`src/ipc/webtoon/processor.ts`)

Pure Node/Sharp module with no Electron imports. Exports:

- **Types**: `ProcessedSegment` (`{ filePath, topGapColor, bottomGapColor }`), `SegmentGapMeta` (gap metadata shape used when serializing sidecar data).
- `processWebtoon({ inputDir, outputDir })` → `Promise<ProcessedSegment[]>` — writes segment PNGs, captures **top/bottom gap colors** from removed uniform strips, and writes **`metadata.json`** in the output directory.
- `writeMetadataJson(outputDir, segments: SegmentGapMeta[])` — writes or overwrites **`metadata.json`** from an array of `{ filename, topGapColor, bottomGapColor }` (exported for handlers and any caller that needs to refresh the sidecar without re-running the full pipeline).
- `splitSegment({ filePath, breakpoints })` → `Promise<string[]>` (N+1 new paths; deletes original)
- `mergeSegments({ filePaths, outputPath })` → `Promise<string>` (merged path; deletes inputs)

Internal helpers: `readImagePaths`, `resetOutputDir`, `createStitchedImage`, `findUniformRowRuns`, `buildSlicesFromRuns`, `writeSlices`, `isUniformRow`.

### Custom Protocol (`local-file://`)

The renderer runs on a Vite dev server (`http://localhost`) during development, which blocks `file://` resource loading. A custom `local-file` scheme is registered to serve local files consistently in both dev and production.

**Registration** (module scope in `src/main.ts`, before `app.ready`):

```typescript
protocol.registerSchemesAsPrivileged([{
  scheme: "local-file",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);
```

**Handler** (inside `app.whenReady`): reads the file directly with `fs.promises.readFile` and returns a `Response` with the correct MIME type:

```typescript
protocol.handle("local-file", async (request) => {
  const url = new URL(request.url);
  const filePath = decodeURIComponent(url.pathname);
  const data = await fs.promises.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  return new Response(data, {
    headers: { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" },
  });
});
```

**URL format**: `local-file://localhost/absolute/path/to/file.png`. The explicit `localhost` host is required because registering as a `standard` scheme causes Chromium to parse the first path component after `://` as the hostname. Without `localhost`, a path like `/Users/nhanbui/...` would have `Users` eaten as the hostname.

**Used for**: grid thumbnails, editor preview, and `new Image()` dimension loading.

### Main Process (`src/main.ts`)

- Registers `local-file://` scheme as privileged (must be before `app.ready`).
- Creates a 1000x800 `BrowserWindow` with hidden title bar, traffic lights positioned for macOS.
- Registers `local-file://` protocol handler using `fs.promises.readFile` for reliable file serving.
- Sets up oRPC server on the `START_ORPC_SERVER` IPC channel.
- Standard macOS `activate` / `window-all-closed` handling.

### Preload (`src/preload.ts`)

Bridges a `MessagePort` from the renderer to the main process for the oRPC connection. Listens for `window` `message` events with `event.data === START_ORPC_SERVER` and forwards the port via `ipcRenderer.postMessage`.

### Renderer UI

- **`src/routes/index.tsx`**: Single page with folder pickers, process button, status display, segment list, segment grid, and split editor modal.
- **`SegmentMeta`** (`src/components/webtoon/types.ts`): Renderer segment state includes `topGapColor: string | null` and `bottomGapColor: string | null` alongside path, dimensions, and optional `splitGroup`.
- **State**: `inputDir`, `outputDir`, `segments[]` (with optional `splitGroup` and gap colors), `statusMessage`, `statusMode`, `isProcessing`, `editingSegment`.
- **`loadSegmentMetadata`**: Creates `new Image()` elements with `local-file://localhost/...` URLs to read `naturalWidth`/`naturalHeight` for each segment. Accepts an optional `splitGroup` tag to assign to the resulting metas.
- **Sorting**: Segments are always sorted by path with `localeCompare({ numeric: true, sensitivity: "base" })`.

---

## Error Handling & Edge Cases

- Empty input folder → throws `"No images found in <dir>"`.
- Missing dimensions on a file → throws from metadata check.
- Invalid split breakpoint (<=0 or >= height) → throws with the specific breakpoint value.
- Merge with fewer than 2 files → throws `"Need at least 2 files to merge."`.
- Dialog cancellation → returns `null`, UI ignores (no state change).
- Folder picker / process / split / merge errors → surfaced in the status display as `"Error: <message>"` in red.

---

## Configuration Knobs

Editable in `src/ipc/webtoon/processor.ts`:

- `MIN_GAP_HEIGHT` — minimum height (px) of a uniform "gap" run to remove.
- `COLOR_TOLERANCE` — per-channel tolerance for "single-color" row detection.

Editable in `src/components/webtoon/segment-grid.tsx`:

- `EDIT_ASPECT_RATIO_THRESHOLD` — height/width ratio above which the Edit button appears (default: `3`).

---

## Build Configuration

### Sharp (native module)

Sharp is a C++ addon that cannot be bundled by Vite. It is:

1. Externalized in `vite.main.config.mts` via `build.rollupOptions.external: ["sharp"]`.
2. Unpacked from the ASAR archive by `@electron-forge/plugin-auto-unpack-natives` in `forge.config.ts`.

### Electron Forge

- **Makers**: Squirrel (Windows), ZIP (macOS), RPM + DEB (Linux).
- **Fuses**: ASAR integrity, cookie encryption, node options disabled.
- **Vite plugin**: Separate configs for main, preload, and renderer.

---

## Differences from Prototype

This app originated as a port of `webtoon-prototype/electron/`. The core stitching and gap-detection pipeline is algorithmically identical, but the app has evolved beyond the prototype:

| Aspect | Prototype | This app |
|--------|-----------|----------|
| IPC | `ipcMain.handle` / `ipcRenderer.invoke` via `contextBridge` | oRPC over MessagePort |
| UI | Static HTML + vanilla JS | React 19 + Tailwind 4 + shadcn/ui |
| Language | ESM JavaScript (`.mjs`) | TypeScript |
| Build | Raw `electron .` | Electron Forge + Vite |
| File previews | `file://` URLs (direct) | `local-file://localhost/` custom protocol (fs.readFile) |
| Packaging | None | Forge makers (Squirrel, ZIP, RPM, DEB) |
| Split editor | Single split line (2 parts) | **Multiple split lines** (N+1 parts) with add/remove |
| Split default | Line at 2000px from top | Line at **50% height** |
| Edit trigger | Height > 2000px | **Height/width ratio > 3** |
| Open button | `<a href="file://...">` (navigates window) | `shell.showItemInFolder()` (reveals in Finder/Explorer) |
| Undo split | Not supported | **Merge group** — stitches sub-segments back into one |

---

## Security Notes

- Context isolation is enabled; the preload only bridges a MessagePort for oRPC.
- oRPC router exposes only whitelisted handler methods.
- The `local-file://` protocol serves local files for previews; acceptable for a local tool. Do not expose this pattern to untrusted remote content.
- Fuses are configured to enforce ASAR integrity, disable `NODE_OPTIONS`, and disable `RunAsNode`.
