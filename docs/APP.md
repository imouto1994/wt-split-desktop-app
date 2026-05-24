# Webtoon Stitch & Split — Implementation & Specification

## Purpose

Desktop application that stitches ordered chapter images into one vertical strip, removes large uniform vertical gaps (blank / single-color bands), exports WebP lossless segments to a folder, and optionally splits oversized segments manually via a visual multi-line editor. The image pipeline uses [Sharp](https://sharp.pixelplumbing.com/).

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
  preload.ts                  # MessagePort bridge for oRPC + contextBridge API (processing progress)
  renderer.ts                 # Entry point → imports app.tsx
  app.tsx                     # React root, RouterProvider, theme/language sync
  constants/index.ts          # IPC channel names, env vars, feature flags, processing defaults, ProgressInfo type
  ipc/
    handler.ts                # RPCHandler wrapping the router
    manager.ts                # Renderer-side oRPC client (IPCManager)
    context.ts                # MainWindow context middleware for oRPC handlers
    router.ts                 # Top-level oRPC router aggregating all namespaces
    webtoon/
      processor.ts            # Image stitching, gap detection, segment I/O, multi-split, merge
      handlers.ts             # oRPC handlers: pickInput, pickOutput, processWebtoon,
                              #   writeMetadata, splitSegment, mergeSegments, deleteFiles, showInFolder
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
      types.ts                # SegmentMeta (paths, dimensions, splitGroup, gap colors, edge strips, cacheKey) + toLocalFileUrl
      folder-picker.tsx       # Button + path display
      status-display.tsx      # Colored status text
      segment-grid.tsx        # Responsive thumbnail grid with Open / Edit / Hide / Undo
      split-editor-modal.tsx  # Multi-line split editor modal
    ui/                       # shadcn/ui primitives (button, toggle, etc.)
    drag-window-region.tsx    # Custom title bar drag region
  layouts/
    base-layout.tsx           # DragWindowRegion + scrollable <main>
  styles/global.css           # Tailwind 4 imports, theme variables, global thin scrollbar CSS
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

- **Output folder**: User may choose explicitly; if omitted, defaults to `<parentDir>/[Toonwide] <inputDirName>` — a sibling of the input folder (same parent directory as the input, folder name is the input’s basename prefixed with `[Toonwide] `). This keeps outputs grouped next to their source folders, and the `[Toonwide]` prefix lets the web app’s batch chapter import treat those directories as processed output when the admin selects the parent folder.
- **Pre-run behavior**: The output directory is deleted and recreated on each full "Process" run.
- **Segment files**: `segment_000.webp`, `segment_001.webp`, ... zero-padded to three digits. All segments use **WebP lossless** encoding for ~20-30% smaller file sizes than PNG with no quality loss.
- **Sidecar**: `metadata.json` is written alongside the segment WebP files. It holds per-segment gap color metadata (`topGapColor`, `bottomGapColor`) and edge strip data URIs (`topEdgeStrip`, `bottomEdgeStrip`) for the web app’s admin upload flow. The file is created/updated by the processor after a full process run and kept in sync via the `writeMetadata` handler on Confirm.

### Stitching

1. For each source file, Sharp reads metadata. EXIF orientation is accounted for (orientations 5-8 swap width/height).
2. Each image is auto-rotated (`.rotate()`) then resized to a common target width: the maximum width among all oriented inputs. Height scales proportionally.
3. Frames are composited top-to-bottom on a transparent RGBA canvas.

### Gap Removal (Automatic Splitting)

1. The stitched image is rendered to a PNG buffer, then re-opened as a Sharp pipeline.
2. Raw RGBA pixels are scanned row-by-row.
3. A row is "uniform" if every pixel matches the **center pixel** (x = width/2) within `colorTolerance` per channel (R, G, B, A). The center pixel is used instead of x=0 to avoid edge artifacts from the stitching/resizing pipeline and to minimize the maximum distance to any pixel in the row.
4. **Cross-row consistency**: contiguous uniform rows are grouped into a "run" only if each row's center pixel also matches the **run's reference color** (the first row's center pixel) within tolerance. This prevents color drift across a run and stops thin border rows (a different uniform color at a gap edge) from being absorbed into the gap.
5. Each run's representative color is sampled from the **center row** (y-midpoint) of the run, then **snapped to pure white (#ffffff) or pure black (#000000)** if within tolerance. Using a single color per run (instead of separate top/bottom row colors) guarantees that two segments separated by the same gap always receive the exact same hex value, producing a clean solid gap in the web reader.
6. **Adjacent gap merging**: When the cross-row check splits a gradual-transition gap into multiple adjacent runs (no content rows between them), they are treated as one logical gap — the first run's color is used for both bounding segments. This prevents color mismatches that would otherwise trigger gradient rendering in the web reader.

**Processing parameters** (user-configurable via the UI, with defaults in `src/constants/index.ts`):

- `DEFAULT_COLOR_TOLERANCE = 20` — per-channel tolerance for "single-color" row detection. Range: 0–255. Also governs the cross-row consistency check and the white/black snap threshold.
- `DEFAULT_MIN_GAP_HEIGHT = 50` — contiguous runs of uniform rows at least this tall are treated as removable gaps; content between those runs becomes segments. Lowered from 100 because the cross-row check excludes border rows from gap runs (shrinking detected gaps) and 50px catches more real panel gaps.

The user can override these per-run in the "Processing Settings" area of the controls card. Empty fields fall back to the defaults. The values are session-only (reset on app restart).

### Manual Segment Split (Editor)

- **Trigger**: The "Edit" button is available on **all** segments. Segments with **height/width ratio greater than 3** (`EDIT_ASPECT_RATIO_THRESHOLD = 3` in `segment-grid.tsx`) get a prominent **amber** Edit button to signal "recommended split," while shorter segments get a subtle **outline** Edit button for optional splitting.
- **Multi-line editor**: Modal with the full segment image in a scrollable area. Supports **multiple split lines** — the user can split a segment into 2, 3, or more sub-segments at once.
  - **Default**: Opens with 1 split line at **50% height** of the segment.
  - **Add line**: "Add" button places a new line in the largest gap between existing lines.
  - **Remove line**: Minus icon on each handle removes that line. At least 1 line must remain.
  - **Drag**: Each line is independently draggable. A 24px invisible hit area makes grabbing easy. Each line has a distinct color (emerald, sky, amber, rose, violet, orange) to distinguish them.
  - **Pixel readout**: Each handle badge shows the approximate pixel position from the top.
- **Save**: Calls `splitSegment` with `{ filePath, breakpoints: number[], keepOriginal: true }` (array of pixel positions, sorted and clamped).
- **Disk effect (staged)**:
  - N+1 new files: `<basename>_<timestamp>_a.webp`, `..._b.webp`, `..._c.webp`, etc. in the same directory. Always WebP lossless regardless of input format.
  - The original file is **preserved** on disk (`keepOriginal: true`) so the split can be undone without re-stitching. The original is only deleted when the user clicks **Confirm**.
- **Gap colors after split**: Child segments inherit gap colors from the parent: the **first** child keeps the parent’s `topGapColor`, the **last** child keeps the parent’s `bottomGapColor`, and **middle** children get `null` for both (or the appropriate null for interior boundaries). **`metadata.json` is NOT updated** during staging — it is only written on Confirm.
- **Edge strips after split**: The processor extracts 1px-tall PNG strips at interior split boundaries and returns them as `data:image/png;base64,...` data URIs alongside the file paths (`SplitSegmentResult.edgeStrips`). The renderer inherits exterior edge strips from the parent (first child gets parent's `topEdgeStrip`, last child gets parent's `bottomEdgeStrip`), enabling gradient gap rendering in the web reader. For nested splits, edge strips propagate correctly through the inheritance chain.
- **UI refresh**: The in-memory segment list removes the old path and appends metadata for all new files; the grid re-sorts by path (numeric-aware). All new sub-segments share a `splitGroup` ID.

### Undo Split (Staged)

- After a split, all resulting sub-segments are tagged with a shared `splitGroup` ID in the renderer state.
- Each sub-segment shows an amber **"Undo split (restore original)"** button in the grid (active even on hidden segments).
- Clicking it on any member **deletes the child files** from disk and **restores the original** segment from the `replacedSegments` state map. No re-stitching via `mergeSegments` is needed — the original file still exists on disk because `keepOriginal` was set.
- If any children were hidden, they are auto-unhidden when the split is undone.
- **Gap colors after merge**: The merged segment’s `topGapColor` comes from the **first** child’s `topGapColor`, and `bottomGapColor` from the **last** child’s `bottomGapColor`. After merge, **`writeMetadata`** updates `metadata.json` for the output directory.

### Preview

- **Grid**: Lazy-loaded thumbnails via `local-file://localhost/...` protocol, index + height + gap color swatches with hex labels. Shows **all** segments including hidden ones (dimmed at `opacity-40`). A dynamic summary ("N visible / M total") is shown in the section header. Each card has an `id="segment-{idx}"` attribute for scroll targeting from the fixed action bar.
- **Open**: Calls `shell.showItemInFolder()` to reveal the file in the OS file manager (Finder / Explorer). Disabled on hidden segments.
- **Edit**: Opens the multi-line split editor. Available on **all** segments — amber button for recommended splits (ratio > 3), outline button for optional splits. Disabled on hidden segments.
- **Hide / Unhide**: Toggles segment visibility for the staged editing workflow.
- **Undo Split**: Restores the original segment by deleting split children (when the segment has a `splitGroup`). Active even on hidden segments.
- After splits, filenames may no longer follow strict `segment_XXX.webp` ordering; sorting is by full path string (numeric-aware).

### Fixed Action Bar

A `position: fixed` bar pinned to the bottom of the viewport (`z-30`, below the split editor modal at `z-50`). Contains two conditional rows:

1. **Hot links row** — scrollable horizontal pills linking to segments flagged as problematic. Two categories:
   - **Too short** (sky-colored pills): segments with `height < MIN_SEGMENT_HEIGHT_PX` (100px). Catches processing artifacts like tiny slivers.
   - **Too tall** (amber-colored pills): segments with `height / width > EDIT_ASPECT_RATIO_THRESHOLD` (3). These likely need manual splitting.
   - Hidden segments are excluded from hot links.
   - Clicking a pill calls `scrollIntoView({ behavior: "smooth", block: "center" })` on the corresponding segment card.
   - Row hidden when no segments are flagged.

2. **Action row** — Confirm/Discard buttons with pending changes summary. Same as the previous inline bar, but now always accessible. Row hidden when `hasPendingChanges` is false.

**Visibility**: The bar appears whenever `segments.length > 0` — i.e., always after processing completes. The Confirm/Discard buttons are always visible but disabled when there are no pending changes. When no changes are pending, the action row shows a segment summary ("N visible / M total") instead of the pending changes text.

**Layout clearance**: `base-layout.tsx` uses `pb-32` (128px) bottom padding on the `<main>` scroll container to ensure the last segment card is never obscured by the fixed bar.

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
| `webtoon` | `pickInput`, `pickOutput`, `processWebtoon`, `writeMetadata`, `splitSegment`, `mergeSegments`, `deleteFiles`, `showInFolder` |
| `app` | `currentPlatfom`, `appVersion` |
| `shell` | `openExternalLink` |
| `theme` | `getCurrentThemeMode`, `toggleThemeMode`, `setThemeMode` |
| `window` | `minimizeWindow`, `maximizeWindow`, `closeWindow` |

### Webtoon Handlers (`src/ipc/webtoon/handlers.ts`)

| Handler | What it does |
|---------|-------------|
| `pickInput` | `dialog.showOpenDialog(window, { properties: ["openDirectory"] })` — returns path or null |
| `pickOutput` | `dialog.showOpenDialog(window, { properties: ["openDirectory", "createDirectory"] })` — returns path or null |
| `processWebtoon` | Takes `{ inputDir, outputDir?, minGapHeight?, colorTolerance? }`. If `outputDir` is omitted, resolves it to `<parentDir>/[Toonwide] <inputDirName>` (sibling of the input); forwards processing params to `processor.processWebtoon()`, returns `{ outputDir, segments }` (each segment includes path + gap colors). Uses `mainWindowContext` middleware to push stage-aware progress events (`stitching`, `analyzing`, `writing`, `finalizing`) to the renderer via `webContents.send(PROCESSING_PROGRESS)` — separate from the oRPC response. |
| `writeMetadata` | Takes `{ outputDir, segments: { filename, topGapColor, bottomGapColor, topEdgeStrip?, bottomEdgeStrip? }[] }`, writes or overwrites `metadata.json` in that directory (called on Confirm to finalize staged edits) |
| `splitSegment` | Takes `{ filePath, breakpoints: number[], keepOriginal?: boolean }`, calls `processor.splitSegment()`, returns `{ files, edgeStrips }` (N+1 paths + per-sub-segment edge strip data URIs). When `keepOriginal` is true, the original file is preserved for staged undo. |
| `mergeSegments` | Takes `{ filePaths, outputPath }`, calls `processor.mergeSegments()`, returns `{ file }` (merged path). **Note:** No longer used by the staged undo flow (retained for potential future use). |
| `deleteFiles` | Takes `{ filePaths: string[] }`, deletes each file via `fs.rm({ force: true })`. Returns `{ failed }` with paths that could not be deleted. Used by staged editing for Confirm, Discard, and undo-split cleanup. |
| `showInFolder` | Calls `shell.showItemInFolder(filePath)` to reveal a file in the OS file manager |

The `pickInput`, `pickOutput`, and `processWebtoon` handlers use the `ipcContext.mainWindowContext` middleware to access the main `BrowserWindow`. Dialog handlers use it for modal sheet attachment; `processWebtoon` uses it to push progress events via `webContents.send`.

### Processor (`src/ipc/webtoon/processor.ts`)

Pure Node/Sharp module with no Electron imports.

**Sharp pixel-limit override**: All `sharp()` construction in this file goes through three helpers — `openSharp(input)` for files/buffers, `createSharp(create)` for synthetic canvases, and `openRawSharp(rawBuffer, width, height)` for raw RGBA byte buffers — all of which set `limitInputPixels: false`. Without this, Sharp throws `Error: Input image exceeds pixel limit` whenever a stitched composite exceeds the default 268,435,456-pixel (0x3FFF × 0x3FFF) cap. Webtoon chapters easily cross this — a 800px-wide composite of ~50 panels at 6000px each is 240 MP and right at the edge. The trade-off: with no upper bound, a truly enormous input (e.g. 100,000 panels) could exhaust memory; the raw RGBA buffer for analysis is `width × height × 4` bytes, so the practical ceiling is set by available RAM, not by the Sharp check. **Always use these helpers rather than `sharp()` directly — a new call site that forgets the option will re-introduce the crash on tall webtoons.**

**Single-pass raw architecture**: After the composite pipeline is built by `createStitchedImage`, `processWebtoon` materializes it **directly to raw RGBA once** (no intermediate PNG encode/decode):

```
composite pipeline
    └── .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
            └── rawBuffer (held in memory for the rest of the pipeline)
                    ├── findUniformRowRuns(rawBuffer, …)  // gap analysis reads directly
                    ├── openRawSharp(rawBuffer, w, h)     // reusable pipeline for…
                    │       ├── writeSlices: .clone().extract().webp().toFile() (× N slices)
                    │       └── extractEdgeStrip: .clone().extract().png().toBuffer()
                    └── (no more PNG anywhere in the hot path)
```

Previously the implementation went `composite → PNG-encode → PNG-decode (× ~N times for every slice and edge strip)`. For a ~178 MP chapter with ~30 slices that meant 30+ full-image PNG decodes of an ~700 MB buffer, making the "Analyzing gaps…" stage take many minutes or appear to hang entirely. The single raw materialization eliminates all of those, reducing both wall time and peak memory by roughly an order of magnitude on real chapters. The historical comment about "forcing Sharp to fully resolve the lazy composite before raw read" referenced a pre-0.32 Sharp bug that no longer applies.

**Correctness regression test**: `npm run smoke:processor` (`scripts/smoke-processor.ts`) runs `processWebtoon` against the bundled `test/` fixture and asserts byte-identity against the committed `[Toonwide] test/` reference output. Run this after any change to `processor.ts` that touches the stitching, analysis, or slice writing path.

Exports:

- **Types**: `ProcessedSegment` (`{ filePath, topGapColor, bottomGapColor, topEdgeStrip, bottomEdgeStrip, topEdgeStripIsLight, bottomEdgeStripIsLight }`), `SegmentGapMeta` (gap + edge strip + brightness metadata for sidecar serialization), `EdgeStripData` (`{ topEdgeStrip, bottomEdgeStrip, topEdgeStripIsLight, bottomEdgeStripIsLight }`), `SplitSegmentResult` (`{ files, edgeStrips }`).
- `processWebtoon({ inputDir, outputDir, minGapHeight?, colorTolerance?, onProgress? })` → `Promise<ProcessedSegment[]>` — writes segment WebP lossless files, captures **gap colors** (center-row color of each removed uniform strip, snapped to white/black when within tolerance) and writes **`metadata.json`** in the output directory. Edge strips are `null` for interior auto-split segments. The **first segment's top row** and **last segment's bottom row** get edge strips with brightness classification (`isLight`) for column boundary gap rendering. Processing params fall back to defaults from `src/constants/index.ts` when omitted. The optional `onProgress` callback (typed as `(info: ProgressInfo) => void`) fires at each pipeline stage: `stitching` (with image count), `analyzing`, `writing` (with segment index/total/filename after each write), and `finalizing`.
- `writeMetadataJson(outputDir, segments: ProcessedSegment[])` — writes or overwrites **`metadata.json`** from an array of `{ filename, topGapColor, bottomGapColor, topEdgeStrip, bottomEdgeStrip, topEdgeStripIsLight, bottomEdgeStripIsLight }`.
- `splitSegment({ filePath, breakpoints, keepOriginal? })` → `Promise<SplitSegmentResult>` (N+1 file paths + per-sub-segment edge strip data URIs with brightness flags; deletes original unless `keepOriginal` is true). Edge strips are extracted at interior split boundaries as 1px-tall PNG data URIs for gradient gap rendering in the web reader. Each strip includes an `isLight` flag based on average perceived luminance (Rec. 601).
- `mergeSegments({ filePaths, outputPath })` → `Promise<string>` (merged path; deletes inputs)

Internal helpers: `readImagePaths`, `resetOutputDir`, `createStitchedImage`, `findUniformRowRuns`, `buildSlicesFromRuns`, `writeSlices`, `isUniformRow`, `getRowColor`, `isColorWithinTolerance`, `snapToCanonicalColor`, `pushRun`, `extractEdgeStrip`.

### Logging and Debugging in Production

Electron Windows builds are GUI apps that don't attach to a console — `console.log` / `console.error` writes are discarded by default. The app ships with three mechanisms to make production failures debuggable:

1. **File logger** (`src/utils/logger.ts`): patches `console.log` / `info` / `warn` / `error` / `debug` to also append to a log file at `app.getPath('logs')/main.log`, plus installs `uncaughtException` and `unhandledRejection` handlers. Initialised at the very top of `app.whenReady()` so every subsequent log line in the main process is captured. Log file path per platform:
   - Windows: `%LocalAppData%\<app-name>\logs\main.log`
   - macOS: `~/Library/Logs/<app-name>/main.log`
   - Linux: `~/.config/<app-name>/logs/main.log`

2. **oRPC error surfacing** (`src/ipc/handler.ts`): the `RPCHandler` is configured with:
   - `interceptors: [onError((err) => console.error(...))]` — logs full handler errors with stack traces to the log file.
   - `clientInterceptors: [onError(...)]` — replaces oRPC's default `"Internal server error"` sanitized message with the actual error message + cause, so the React UI's status display shows the real cause (e.g. `"ENOENT: no such file or directory"`) instead of a useless generic string.

3. **DevTools in production**: `webPreferences.devTools: true` is set unconditionally. Users can open DevTools with `Cmd/Ctrl+Shift+I` or right-click → Inspect to see renderer-side errors, network requests, and React state. This is acceptable for an internal/personal tool — for public distribution, gate behind a debug flag.

When a user reports a bug, ask them for the last ~50 lines of `main.log` and any errors in the renderer console.

### Custom Protocol (`local-file://`)

The renderer runs on a Vite dev server (`http://localhost`) during development, which blocks `file://` resource loading. A custom `local-file` scheme is registered to serve local files consistently in both dev and production.

**Registration** (module scope in `src/main.ts`, before `app.ready`):

```typescript
protocol.registerSchemesAsPrivileged([{
  scheme: "local-file",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);
```

**Handler** (inside `app.whenReady`): reads the file directly with `fs.promises.readFile` and returns a `Response` with the correct MIME type and `Cache-Control: no-store` to prevent Chromium from serving stale content after files are overwritten:

```typescript
protocol.handle("local-file", async (request) => {
  const url = new URL(request.url);
  const filePath = decodeURIComponent(url.pathname);
  const data = await fs.promises.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  return new Response(data, {
    headers: {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
});
```

**URL format**: `local-file://localhost/absolute/path/to/file.png`. The explicit `localhost` host is required because registering as a `standard` scheme causes Chromium to parse the first path component after `://` as the hostname. Without `localhost`, a path like `/Users/nhanbui/...` would have `Users` eaten as the hostname.

**Cache busting**: When segment files are overwritten at the same path (e.g. re-processing with different parameters), Chromium's in-memory image decode cache can serve stale bitmaps even with `Cache-Control: no-store`. To address this, `toLocalFileUrl(path, cacheKey)` appends an optional `?v=<timestamp>` query parameter. The protocol handler uses `url.pathname` only, so the query is ignored server-side. `loadSegmentMetadata` sets `cacheKey = Date.now()` on each batch, and all image-rendering components (`SegmentGrid`, `SplitEditorModal`) pass `seg.cacheKey` to `toLocalFileUrl`.

**Used for**: grid thumbnails, editor preview, and `new Image()` dimension loading.

### Main Process (`src/main.ts`)

- Registers `local-file://` scheme as privileged (must be before `app.ready`).
- Creates a 1000x800 `BrowserWindow` with hidden title bar, traffic lights positioned for macOS.
- Registers `local-file://` protocol handler using `fs.promises.readFile` for reliable file serving.
- Sets up oRPC server on the `START_ORPC_SERVER` IPC channel.
- Standard macOS `activate` / `window-all-closed` handling.

### Preload (`src/preload.ts`)

Two independent APIs:

1. **oRPC MessagePort bridge**: Listens for `window` `message` events with `event.data === START_ORPC_SERVER` and forwards the port via `ipcRenderer.postMessage`.
2. **`electronAPI` via `contextBridge`**: Exposes `onProcessingProgress(callback)` which subscribes to `PROCESSING_PROGRESS` IPC events from the main process and returns a cleanup function. This push channel is separate from oRPC (which is request/response only) and carries `ProgressInfo` payloads during the processWebtoon pipeline.

### Renderer UI

- **`src/routes/index.tsx`**: Single page with folder pickers, processing parameters, process button, status display, segment grid, split editor modal, and a **fixed action bar** pinned to the bottom of the viewport. The action bar contains hot links to flagged segments (too short or too tall) and Confirm/Discard buttons when there are pending staged changes. During processing, the status display shows stage-aware progress ("Stitching 15 images…", "Writing segment 3 of 12…", etc.) via IPC events from the main process, replacing the previous static "Processing…" message.
- **`SegmentMeta`** (`src/components/webtoon/types.ts`): Renderer segment state includes `topGapColor`, `bottomGapColor`, `topEdgeStrip`, `bottomEdgeStrip` (all `string | null`) alongside path, dimensions, optional `splitGroup`, and optional `cacheKey` (timestamp for image URL cache busting).
- **State**: Core state (`inputDir`, `outputDir`, `minGapHeight`, `colorTolerance`), staging state (`baseSegments`, `segments`, `hiddenPaths`, `replacedSegments`, `createdBySplitFiles`), UI state (`statusMessage`, `statusMode`, `isProcessing`, `isCommitting`, `editingSegment`). Derived: `hasPendingChanges`, `visibleSegments`, `flaggedSegments` (segments with height issues), `showActionBar`.
- **`loadSegmentMetadata`**: Creates `new Image()` elements with cache-busted `local-file://localhost/...?v=<timestamp>` URLs to read `naturalWidth`/`naturalHeight` for each segment. Sets a shared `cacheKey` (via `Date.now()`) on all resulting metas so grid and editor `<img>` elements also bypass the decode cache. Accepts an optional `splitGroup` tag to assign to the resulting metas.
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

Shared defaults and types in `src/constants/index.ts` (importable by main process, preload, and renderer):

- `DEFAULT_MIN_GAP_HEIGHT = 50` — minimum height (px) of a uniform "gap" run to remove. Lowered from 100 because the cross-row consistency check excludes border rows, shrinking detected gaps. User-configurable per-run via the Processing Settings UI.
- `DEFAULT_COLOR_TOLERANCE = 20` — per-channel tolerance for "single-color" row detection and cross-row consistency. Raised from 10 to handle compression artifacts; safe because the cross-row check prevents color drift. User-configurable per-run via the Processing Settings UI (range: 0–255).
- `IPC_CHANNELS.PROCESSING_PROGRESS` — Electron IPC channel name for push-style processing progress events from main → renderer.
- `ProgressInfo` — type for progress payloads: `{ stage: ProgressStage, current?, total?, detail? }`. Stages are `"stitching"`, `"analyzing"`, `"writing"`, `"finalizing"`. Shared across main (processor callback), preload (contextBridge), and renderer (subscription + type declaration in `types.d.ts`).

- `MIN_SEGMENT_HEIGHT_PX = 100` — segments shorter than this (in pixels) are flagged as "too short" in the fixed action bar's hot links. Catches tiny slivers from the gap-detection pipeline without flagging legitimate small panels.

Editable in `src/components/webtoon/segment-grid.tsx`:

- `EDIT_ASPECT_RATIO_THRESHOLD` — height/width ratio above which the Edit button gets a prominent amber style (default: `3`). Also used by the fixed action bar to flag segments as "too tall" in the hot links.

---

## Build Configuration

### Sharp (native module)

Sharp is a C++ addon. Sharp 0.33+ split its prebuilt binaries into platform-specific `@img/sharp-<platform>-<arch>` packages (plus `@img/sharp-libvips-<platform>-<arch>` for libvips). Three things must line up for the packaged app to load Sharp:

1. **Externalized in `vite.main.config.mts`**: `build.rollupOptions.external: ["sharp", /^@img\//]`. Both `sharp` and the dynamically-required `@img/*` packages must be excluded from the bundle so Rollup doesn't try to follow the platform-specific dynamic import.

2. **Included in the packaged app by `@timfish/forge-externals-plugin`** (in `forge.config.ts` plugins, AFTER `VitePlugin`). The Vite plugin only marks Sharp as external; it does NOT copy `node_modules/sharp/` into the final app. Without this plugin, the packaged app crashes with `Cannot find module 'sharp'`. The plugin is configured with `externals: ["sharp"], includeDeps: true` so Sharp's full transitive tree (including `@img/sharp-<platform>-<arch>` and `@img/sharp-libvips-<platform>-<arch>`) is copied into the packaged app's `node_modules`.

3. **Unpacked from the asar archive** via `packagerConfig.asar.unpack: "**/node_modules/{sharp,@img}/**/*"` in `forge.config.ts`. Native binaries (`.node`, `.dylib`, `.dll`, `.so`) cannot be loaded from inside an asar — the OS dynamic linker needs them on the real filesystem. The glob covers both `sharp/` and the `@img/` family.

After `npm run make`, you can verify all three are working by inspecting the packaged output:
```
out/Webtoon Stitch & Split-<platform>-<arch>/.../Resources/app.asar.unpacked/node_modules/
├── sharp/
└── @img/
    ├── sharp-<platform>-<arch>/
    └── sharp-libvips-<platform>-<arch>/
```

If the `app.asar.unpacked` directory is missing or empty, the packaging chain is broken.

**Note**: `@electron-forge/plugin-auto-unpack-natives` was previously listed here but has been removed — it only adds an `asar.unpack` glob for native modules already present in the asar, which doesn't help when the module isn't being copied into the asar in the first place. The explicit `asar.unpack` glob plus `@timfish/forge-externals-plugin` handles both halves correctly. See [Sharp #4116](https://github.com/lovell/sharp/issues/4116) and [Forge #4144](https://github.com/electron/forge/issues/4144) for the upstream discussion.

### Electron Forge

- **Makers**: Squirrel (Windows), ZIP (macOS), RPM + DEB (Linux).
- **Fuses**: ASAR integrity, cookie encryption, node options disabled.
- **Vite plugin**: Separate configs for main, preload, and renderer.
- **Publisher**: `@electron-forge/publisher-github` configured to publish draft releases to `imouto1994/wt-split-desktop-app`. The `update-electron-app` integration in `src/main.ts` polls the same repo via Electron's public update service (works only because the repo is public).

### CI builds (GitHub Actions)

Three workflows live in `.github/workflows/`. The desktop app is its own Git repo nested in the parent monorepo folder, so workflows live next to the app code, not at the parent repo root.

| Workflow | Trigger | Runner(s) | What it produces |
|---|---|---|---|
| `check.yaml` | PR to `main` | `ubuntu-latest` | Ultracite lint result; no build artifact |
| `testing.yaml` | push/PR to `main` | `ubuntu-latest` (unit) + `windows-latest` (e2e) | Vitest unit results + Playwright HTML report (build is produced by `npm run make` on Windows but discarded — only `playwright-report/` is uploaded) |
| `build.yaml` | push to `main`, `workflow_dispatch` | `windows-latest` + `macos-latest` (parallel jobs) | Per-commit downloadable installers: Windows Squirrel `Setup.exe` + `.nupkg` + `RELEASES`; macOS arm64 ZIP. 30-day retention. Hard-fails if Forge produced no files (`if-no-files-found: error`). Concurrency-cancellable so rapid pushes don't stack runs. |
| `publish.yaml` | `workflow_dispatch` (manual) | `windows-latest` then `macos-latest` (serialized via `needs:`) | Single GitHub draft release containing both platforms' installers. Serialized to avoid the `getOrCreateDraftRelease` race where two parallel runners both try to `POST /releases`. |

**Per-commit build artifacts** for `main` are produced unsigned and unnotarized (V1 scope). End users will see SmartScreen on Windows and Gatekeeper "damaged or can't be opened" on macOS arm64 — the README has the workarounds. Production distribution would require purchasing an Apple Developer ID certificate + a Windows EV/OV code signing cert.

**macOS DMG** is intentionally not included in V1. Adding `MakerDMG` requires the `@electron-forge/maker-dmg` package whose transitive `appdmg` is darwin-only; if Forge eagerly imports it on the Windows runner during `electron-forge make`, the Windows job breaks. DMG can be added in a follow-up after the V1 ZIP-only flow is verified green on both runners.

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

- Context isolation is enabled; the preload bridges a MessagePort for oRPC and exposes a minimal `electronAPI` via `contextBridge` for processing progress events.
- oRPC router exposes only whitelisted handler methods.
- The `local-file://` protocol serves local files for previews; acceptable for a local tool. Do not expose this pattern to untrusted remote content.
- Fuses are configured to enforce ASAR integrity, disable `NODE_OPTIONS`, and disable `RunAsNode`.
