/**
 * Main page — the single route for the webtoon processor UI.
 *
 * Manages all application state including the **staged editing workflow**:
 * after processing, the user can hide segments, split segments, and undo
 * splits — all as staged changes. Only when the user clicks "Confirm" are
 * changes written to disk (hidden files deleted, replaced originals removed,
 * metadata.json updated). "Discard" reverts all staged changes.
 *
 * Data flow:
 *   1. User picks input (and optionally output) folder
 *   2. User configures processing parameters (min gap height, color tolerance)
 *   3. User clicks Process → calls processWebtoon IPC → gets back file paths
 *   4. loadSegmentMetadata loads dimensions for each file using new Image()
 *   5. Segments render in a list and grid (base state established)
 *   6. User can Hide / Unhide / Split / Undo Split segments (staged changes)
 *   7. User clicks Confirm to finalize or Discard to revert
 */
import { createFileRoute } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  deleteFiles,
  pickInputFolder,
  pickOutputFolder,
  processWebtoon,
  splitSegment,
  writeMetadata,
} from "@/actions/webtoon";
import FolderPicker from "@/components/webtoon/folder-picker";
import SegmentGrid, {
  EDIT_ASPECT_RATIO_THRESHOLD,
} from "@/components/webtoon/segment-grid";
import SplitEditorModal from "@/components/webtoon/split-editor-modal";
import StatusDisplay from "@/components/webtoon/status-display";
import { type SegmentMeta, toLocalFileUrl } from "@/components/webtoon/types";
import {
  DEFAULT_COLOR_TOLERANCE,
  DEFAULT_MIN_GAP_HEIGHT,
  MIN_SEGMENT_HEIGHT_PX,
} from "@/constants";

type StatusMode = "info" | "ok" | "warn" | "error";

/**
 * Loads image dimensions for a list of file paths by creating off-screen
 * Image elements with local-file:// URLs. This mirrors the prototype's
 * approach of reading naturalWidth/naturalHeight from the browser engine.
 *
 * @param opts.splitGroup - Group ID shared by all sub-segments from one split.
 * @param opts.splitOriginalPath - Original file path before the split, so
 *   merging can restore the filename and preserve sort position.
 * @param opts.gapColors - Per-file gap colors to attach. Indices match `files`.
 * @param opts.edgeStrips - Per-file edge strip data URIs. Indices match `files`.
 */
function loadSegmentMetadata(
  files: string[],
  opts?: {
    splitGroup?: string;
    splitOriginalPath?: string;
    gapColors?: { topGapColor: string | null; bottomGapColor: string | null }[];
    edgeStrips?: {
      topEdgeStrip: string | null;
      bottomEdgeStrip: string | null;
      topEdgeStripIsLight: boolean | null;
      bottomEdgeStripIsLight: boolean | null;
    }[];
  },
): Promise<SegmentMeta[]> {
  // Shared timestamp for this batch — all segments from one load share the
  // same cache key so lazy-loaded images stay consistent within a run.
  const cacheKey = Date.now();
  return Promise.all(
    files.map(
      (file, i) =>
        new Promise<SegmentMeta>((resolve) => {
          const colors = opts?.gapColors?.[i];
          const strips = opts?.edgeStrips?.[i];
          const img = new Image();
          img.onload = () =>
            resolve({
              path: file,
              width: img.naturalWidth || 0,
              height: img.naturalHeight || 0,
              topGapColor: colors?.topGapColor ?? null,
              bottomGapColor: colors?.bottomGapColor ?? null,
              topEdgeStrip: strips?.topEdgeStrip ?? null,
              bottomEdgeStrip: strips?.bottomEdgeStrip ?? null,
              topEdgeStripIsLight: strips?.topEdgeStripIsLight ?? null,
              bottomEdgeStripIsLight: strips?.bottomEdgeStripIsLight ?? null,
              splitGroup: opts?.splitGroup,
              splitOriginalPath: opts?.splitOriginalPath,
              cacheKey,
            });
          // Resolve with zero dimensions on error so the UI still renders
          // (the thumbnail will show a broken image icon).
          img.onerror = () =>
            resolve({
              path: file,
              width: 0,
              height: 0,
              topGapColor: colors?.topGapColor ?? null,
              bottomGapColor: colors?.bottomGapColor ?? null,
              topEdgeStrip: strips?.topEdgeStrip ?? null,
              bottomEdgeStrip: strips?.bottomEdgeStrip ?? null,
              topEdgeStripIsLight: strips?.topEdgeStripIsLight ?? null,
              bottomEdgeStripIsLight: strips?.bottomEdgeStripIsLight ?? null,
              splitGroup: opts?.splitGroup,
              splitOriginalPath: opts?.splitOriginalPath,
              cacheKey,
            });
          // Cache-busted URL ensures Chromium's image decode cache does not
          // serve stale bitmaps when files at the same path are overwritten
          // (e.g. after re-processing with different parameters).
          img.src = toLocalFileUrl(file, cacheKey);
        }),
    ),
  );
}

/** Sorts segments by path using numeric-aware comparison ("2" before "10"). */
function sortSegments(segs: SegmentMeta[]): SegmentMeta[] {
  return [...segs].sort((a, b) =>
    a.path.localeCompare(b.path, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

/**
 * Strips staging metadata (splitGroup, splitOriginalPath) from segments
 * when they become the new base after Confirm. Committed segments are
 * no longer undoable, so these fields would be misleading.
 *
 * Note: cacheKey is intentionally preserved in `...rest` — committed
 * segments should keep their cache version so thumbnails stay valid.
 */
function stripStagingFields(segs: SegmentMeta[]): SegmentMeta[] {
  return segs.map(({ splitGroup, splitOriginalPath, ...rest }) => rest);
}

function HomePage() {
  // ─── Folder pickers ────────────────────────────────────────────────
  const [inputDir, setInputDir] = useState("");
  const [outputDir, setOutputDir] = useState("");
  /** The resolved output directory from the last processWebtoon run. */
  const [resolvedOutputDir, setResolvedOutputDir] = useState("");

  // ─── Processing parameters ─────────────────────────────────────────
  // undefined = use default. Stored as undefined so the placeholder text
  // can show the default value and empty fields fall through to processor defaults.
  const [minGapHeight, setMinGapHeight] = useState<number | undefined>();
  const [colorTolerance, setColorTolerance] = useState<number | undefined>();

  // ─── Staging state ─────────────────────────────────────────────────
  /** Snapshot from last Process or Confirm — files on disk match this. */
  const [baseSegments, setBaseSegments] = useState<SegmentMeta[]>([]);
  /** Current working segments (split children replace originals). */
  const [segments, setSegments] = useState<SegmentMeta[]>([]);
  /** Paths the user has hidden (still on disk, shown dimmed in grid). */
  const [hiddenPaths, setHiddenPaths] = useState<Set<string>>(new Set());
  /**
   * Original segments replaced by splits — full SegmentMeta stored so undo
   * can restore them without re-reading disk. Keyed by file path.
   */
  const [replacedSegments, setReplacedSegments] = useState<Map<string, SegmentMeta>>(new Map());
  /** All child file paths created by staged splits — deleted on Discard. */
  const [createdBySplitFiles, setCreatedBySplitFiles] = useState<Set<string>>(new Set());

  // ─── UI state ──────────────────────────────────────────────────────
  const [resultSummary, setResultSummary] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusMode, setStatusMode] = useState<StatusMode>("info");
  const [isProcessing, setIsProcessing] = useState(false);
  /** Busy flag for Confirm/Discard — disables all editing buttons. */
  const [isCommitting, setIsCommitting] = useState(false);
  const [editingSegment, setEditingSegment] = useState<SegmentMeta | null>(null);

  // ─── Derived state ─────────────────────────────────────────────────
  const hasPendingChanges = hiddenPaths.size > 0 || replacedSegments.size > 0;
  const visibleSegments = useMemo(
    () => segments.filter((s) => !hiddenPaths.has(s.path)),
    [segments, hiddenPaths],
  );
  const isBusy = isProcessing || isCommitting;
  const hiddenCount = hiddenPaths.size;
  const splitCount = replacedSegments.size;

  /**
   * Segments flagged as problematic — either too short (likely processing
   * artifacts) or too tall (likely need splitting). Hidden segments are
   * excluded since the user has already decided to skip them.
   * Used by the fixed action bar to render scroll-to hot links.
   */
  const flaggedSegments = useMemo(() => {
    const result: { idx: number; seg: SegmentMeta; reason: "short" | "tall" }[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (hiddenPaths.has(seg.path)) continue;
      if (seg.height < MIN_SEGMENT_HEIGHT_PX) {
        result.push({ idx: i, seg, reason: "short" });
      } else if (seg.width > 0 && seg.height / seg.width > EDIT_ASPECT_RATIO_THRESHOLD) {
        result.push({ idx: i, seg, reason: "tall" });
      }
    }
    return result;
  }, [segments, hiddenPaths]);

  /** Whether the fixed action bar should be visible — always shown once segments exist. */
  const showActionBar = segments.length > 0;

  // ─── Helpers ───────────────────────────────────────────────────────

  const setStatus = useCallback(
    (message: string, mode: StatusMode = "info") => {
      setStatusMessage(message);
      setStatusMode(mode);
    },
    [],
  );

  /** Clears all staging state back to a clean slate. */
  const clearStagingState = useCallback(() => {
    setHiddenPaths(new Set());
    setReplacedSegments(new Map());
    setCreatedBySplitFiles(new Set());
  }, []);

  // ─── Folder picker handlers ────────────────────────────────────────

  const handlePickInput = useCallback(async () => {
    try {
      const selection = await pickInputFolder();
      if (selection) {
        setInputDir(selection);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${message}`, "error");
    }
  }, [setStatus]);

  const handlePickOutput = useCallback(async () => {
    try {
      const selection = await pickOutputFolder();
      if (selection) {
        setOutputDir(selection);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${message}`, "error");
    }
  }, [setStatus]);

  // ─── Process handler ───────────────────────────────────────────────

  /**
   * Runs the full stitch + auto-split pipeline.
   * If there are pending staged changes, warns the user and runs Discard
   * logic first to clean up staged files before re-processing.
   */
  const handleProcess = useCallback(async () => {
    if (!inputDir) {
      setStatus("Please choose an input folder first.", "warn");
      return;
    }

    // Warn if there are staged changes that will be lost
    if (hasPendingChanges) {
      const confirmed = window.confirm(
        "You have unsaved changes that will be lost. Continue?",
      );
      if (!confirmed) return;

      // Clean up staged split files before processing overwrites the output dir
      if (createdBySplitFiles.size > 0) {
        await deleteFiles([...createdBySplitFiles]).catch(() => {});
      }
    }

    setStatus("Processing\u2026");
    setResultSummary("");
    setSegments([]);
    setBaseSegments([]);
    clearStagingState();
    setIsProcessing(true);

    // Subscribe to stage-aware progress events pushed from the main process
    // via Electron IPC (separate from the oRPC request/response channel).
    const unsubscribe = window.electronAPI.onProcessingProgress((info) => {
      switch (info.stage) {
        case "stitching":
          setStatus(`Stitching ${info.detail}\u2026`);
          break;
        case "analyzing":
          setStatus("Analyzing gaps\u2026");
          break;
        case "writing":
          setStatus(
            `Writing segment ${info.current} of ${info.total}\u2026`,
          );
          break;
        case "finalizing":
          setStatus("Finalizing\u2026");
          break;
      }
    });

    try {
      const res = await processWebtoon({
        inputDir,
        outputDir: outputDir || undefined,
        minGapHeight,
        colorTolerance,
      });
      const { segments: processed, outputDir: resolvedOutput } = res;

      if (processed.length === 0) {
        setStatus(
          "No content segments found. Try lowering Color Tolerance or raising Min Gap Height.",
          "warn",
        );
      } else {
        setStatus(`Done. Wrote ${processed.length} files.`, "ok");
      }

      setResultSummary(`Output folder: ${resolvedOutput}`);
      setResolvedOutputDir(resolvedOutput);
      const metas = await loadSegmentMetadata(
        processed.map((s) => s.filePath),
        {
          gapColors: processed.map((s) => ({
            topGapColor: s.topGapColor,
            bottomGapColor: s.bottomGapColor,
          })),
        },
      );
      const sorted = sortSegments(metas);
      setSegments(sorted);
      setBaseSegments(sorted);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${message}`, "error");
    } finally {
      unsubscribe();
      setIsProcessing(false);
    }
  }, [inputDir, outputDir, minGapHeight, colorTolerance, setStatus, hasPendingChanges, createdBySplitFiles, clearStagingState]);

  // ─── Staged editing handlers ───────────────────────────────────────

  const handleHide = useCallback((segment: SegmentMeta) => {
    setHiddenPaths((prev) => new Set(prev).add(segment.path));
  }, []);

  const handleUnhide = useCallback((segment: SegmentMeta) => {
    setHiddenPaths((prev) => {
      const next = new Set(prev);
      next.delete(segment.path);
      return next;
    });
  }, []);

  const handleEdit = useCallback((segment: SegmentMeta) => {
    setEditingSegment(segment);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setEditingSegment(null);
  }, []);

  /**
   * Called when the split editor saves. Sends breakpoints to the main process
   * with keepOriginal=true so the original file is preserved for undo.
   * Tracks the parent in replacedSegments and children in createdBySplitFiles.
   *
   * Gap color inheritance: the first child gets the parent's topGapColor,
   * the last child gets the parent's bottomGapColor, middle children get null.
   *
   * Edge strip inheritance mirrors gap colors: the processor extracts strips
   * at interior boundaries (returning null for first-top and last-bottom).
   * The renderer fills exterior edges from the parent's edge strips, which
   * handles nested splits correctly (a middle child's edge strips propagate
   * to its own children's exterior edges).
   */
  const handleSaveSplit = useCallback(
    async (filePath: string, breakpointsPx: number[]) => {
      try {
        setStatus("Splitting segment\u2026");
        const parent = segments.find((s) => s.path === filePath);
        const res = await splitSegment({
          filePath,
          breakpoints: breakpointsPx,
          keepOriginal: true,
        });
        // Tag all new sub-segments with a shared group ID and remember the
        // original path so undo can restore the filename and sort position.
        const groupId = `split_${Date.now()}`;
        const numChildren = res.files.length;
        const gapColors = res.files.map((_, i) => ({
          topGapColor: i === 0 ? (parent?.topGapColor ?? null) : null,
          bottomGapColor:
            i === numChildren - 1 ? (parent?.bottomGapColor ?? null) : null,
        }));
        // Edge strip inheritance: processor returns null for first-top and
        // last-bottom (exterior boundaries). Fill those from the parent so
        // nested splits propagate edge strips and isLight flags correctly.
        const childEdgeStrips = res.edgeStrips.map((strip, i) => ({
          topEdgeStrip: i === 0
            ? (parent?.topEdgeStrip ?? null)
            : strip.topEdgeStrip,
          bottomEdgeStrip: i === numChildren - 1
            ? (parent?.bottomEdgeStrip ?? null)
            : strip.bottomEdgeStrip,
          topEdgeStripIsLight: i === 0
            ? (parent?.topEdgeStripIsLight ?? null)
            : strip.topEdgeStripIsLight,
          bottomEdgeStripIsLight: i === numChildren - 1
            ? (parent?.bottomEdgeStripIsLight ?? null)
            : strip.bottomEdgeStripIsLight,
        }));
        const newMetas = await loadSegmentMetadata(res.files, {
          splitGroup: groupId,
          splitOriginalPath: filePath,
          gapColors,
          edgeStrips: childEdgeStrips,
        });

        // Track the parent for undo and children for Discard cleanup
        if (parent) {
          setReplacedSegments((prev) => new Map(prev).set(filePath, parent));
        }
        setCreatedBySplitFiles((prev) => {
          const next = new Set(prev);
          for (const f of res.files) next.add(f);
          return next;
        });

        const updated = sortSegments(
          segments.filter((s) => s.path !== filePath).concat(newMetas),
        );
        setSegments(updated);
        setStatus(
          `Split into ${newMetas.length} parts. Heights: ${newMetas.map((m) => m.height).join(", ")}px`,
          "ok",
        );
        setEditingSegment(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(`Error: ${message}`, "error");
      }
    },
    [setStatus, segments],
  );

  /**
   * Undoes a staged split by deleting child files and restoring the original
   * segment from replacedSegments. No re-stitching — the original file still
   * exists on disk because splitSegment was called with keepOriginal=true.
   *
   * Auto-unhides any hidden children in the group.
   */
  const handleUndoSplit = useCallback(
    async (groupId: string) => {
      const groupSegments = sortSegments(
        segments.filter((s) => s.splitGroup === groupId),
      );
      if (groupSegments.length === 0) return;

      const originalPath = groupSegments[0].splitOriginalPath;
      if (!originalPath) return;

      const original = replacedSegments.get(originalPath);
      if (!original) return;

      try {
        setStatus("Undoing split\u2026");
        const childPaths = groupSegments.map((s) => s.path);

        // Delete the child files from disk
        if (childPaths.length > 0) {
          await deleteFiles(childPaths);
        }

        // Remove children from staging trackers
        setCreatedBySplitFiles((prev) => {
          const next = new Set(prev);
          for (const p of childPaths) next.delete(p);
          return next;
        });
        setReplacedSegments((prev) => {
          const next = new Map(prev);
          next.delete(originalPath);
          return next;
        });

        // Auto-unhide any hidden children
        setHiddenPaths((prev) => {
          const next = new Set(prev);
          for (const p of childPaths) next.delete(p);
          return next;
        });

        // Swap children back to the original in the segment list
        const childPathSet = new Set(childPaths);
        const updated = sortSegments(
          segments.filter((s) => !childPathSet.has(s.path)).concat([original]),
        );
        setSegments(updated);
        setStatus("Split undone. Original segment restored.", "ok");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(`Error: ${message}`, "error");
      }
    },
    [segments, replacedSegments, setStatus],
  );

  // ─── Confirm / Discard handlers ────────────────────────────────────

  /**
   * Finalizes all staged changes to disk:
   *   1. Write metadata.json FIRST (idempotent, safe to retry)
   *   2. Delete hidden files and replaced split originals
   *   3. Update base state to match the new committed state
   */
  const handleConfirm = useCallback(async () => {
    setIsCommitting(true);
    try {
      // Write metadata first — if this fails, no files are deleted yet
      if (resolvedOutputDir) {
        await writeMetadata({
          outputDir: resolvedOutputDir,
          segments: visibleSegments.map((s) => ({
            filename: s.path.split(/[\\/]/).pop()!,
            topGapColor: s.topGapColor,
            bottomGapColor: s.bottomGapColor,
            topEdgeStrip: s.topEdgeStrip ?? null,
            bottomEdgeStrip: s.bottomEdgeStrip ?? null,
            topEdgeStripIsLight: s.topEdgeStripIsLight ?? null,
            bottomEdgeStripIsLight: s.bottomEdgeStripIsLight ?? null,
          })),
        });
      }

      // Collect files to delete: hidden segments + replaced originals
      const toDelete = [
        ...hiddenPaths,
        ...replacedSegments.keys(),
      ];
      if (toDelete.length > 0) {
        const result = await deleteFiles(toDelete);
        if (result.failed.length > 0) {
          setStatus(
            `Changes confirmed, but ${result.failed.length} file(s) could not be deleted.`,
            "warn",
          );
        } else {
          setStatus("Changes confirmed.", "ok");
        }
      } else {
        setStatus("Changes confirmed.", "ok");
      }

      // Strip staging metadata from committed segments
      const newBase = stripStagingFields(visibleSegments);
      setBaseSegments(newBase);
      setSegments(newBase);
      clearStagingState();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Error confirming: ${message}`, "error");
    } finally {
      setIsCommitting(false);
    }
  }, [resolvedOutputDir, visibleSegments, hiddenPaths, replacedSegments, clearStagingState, setStatus]);

  /**
   * Reverts all staged changes:
   *   1. Delete any files created by staged splits
   *   2. Restore segments to the base state
   */
  const handleDiscard = useCallback(async () => {
    setIsCommitting(true);
    try {
      if (createdBySplitFiles.size > 0) {
        await deleteFiles([...createdBySplitFiles]);
      }
      setSegments(baseSegments);
      clearStagingState();
      setStatus("Changes discarded.", "ok");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Error discarding: ${message}`, "error");
    } finally {
      setIsCommitting(false);
    }
  }, [createdBySplitFiles, baseSegments, clearStagingState, setStatus]);

  // ─── Processing parameter handlers ─────────────────────────────────

  const handleMinGapHeightChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (raw === "") {
        setMinGapHeight(undefined);
        return;
      }
      const val = Math.floor(Number(raw));
      if (!Number.isNaN(val) && val >= 1) {
        setMinGapHeight(val);
      }
    },
    [],
  );

  const handleColorToleranceChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (raw === "") {
        setColorTolerance(undefined);
        return;
      }
      const val = Math.floor(Number(raw));
      if (!Number.isNaN(val) && val >= 0 && val <= 255) {
        setColorTolerance(val);
      }
    },
    [],
  );

  const handleResetParams = useCallback(() => {
    setMinGapHeight(undefined);
    setColorTolerance(undefined);
  }, []);

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
      {/* Controls section: folder pickers + processing params + process button */}
      <section className="rounded-xl border border-border bg-card p-4 shadow-lg">
        <h1 className="mb-1 font-bold text-xl">Webtoon Stitch &amp; Split</h1>
        <p className="mb-4 text-muted-foreground text-sm">
          Pick an input folder and (optionally) an output folder, then process.
        </p>

        <div className="flex flex-col gap-2.5">
          <FolderPicker
            label="Choose Input Folder"
            selectedPath={inputDir}
            onPick={handlePickInput}
          />
          <FolderPicker
            label="Choose Output Folder (optional)"
            selectedPath={outputDir}
            onPick={handlePickOutput}
          />

          {/* Processing parameters */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-background p-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="minGapHeight"
                className="text-muted-foreground text-xs"
              >
                Min Gap Height (px)
              </label>
              <input
                id="minGapHeight"
                type="number"
                step="1"
                min="1"
                placeholder={String(DEFAULT_MIN_GAP_HEIGHT)}
                value={minGapHeight ?? ""}
                onChange={handleMinGapHeightChange}
                className="h-8 w-28 rounded-md border border-border bg-card px-2 text-sm"
              />
              <span className="text-muted-foreground text-[11px]">
                Bands shorter than this are kept as content.
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="colorTolerance"
                className="text-muted-foreground text-xs"
              >
                Color Tolerance (0–255)
              </label>
              <input
                id="colorTolerance"
                type="number"
                step="1"
                min="0"
                max="255"
                placeholder={String(DEFAULT_COLOR_TOLERANCE)}
                value={colorTolerance ?? ""}
                onChange={handleColorToleranceChange}
                className="h-8 w-28 rounded-md border border-border bg-card px-2 text-sm"
              />
              <span className="text-muted-foreground text-[11px]">
                Per-channel tolerance for uniform row detection.
              </span>
            </div>
            {(minGapHeight !== undefined || colorTolerance !== undefined) && (
              <button
                type="button"
                onClick={handleResetParams}
                className="flex h-8 items-center gap-1 rounded-md border border-border px-2 text-muted-foreground text-xs transition-colors hover:bg-muted"
              >
                <RotateCcw className="size-3" />
                Reset
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleProcess}
              className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/80 disabled:pointer-events-none disabled:opacity-50"
            >
              Process
            </button>
            <StatusDisplay message={statusMessage} mode={statusMode} />
          </div>
        </div>
      </section>

      {/* Results section: thumbnail grid + confirm/discard */}
      <section className="rounded-xl border border-border bg-card p-4 shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold text-lg">Generated Segments</h2>
          {segments.length > 0 && (
            <span className="text-muted-foreground text-sm">
              {visibleSegments.length} visible / {segments.length} total
            </span>
          )}
        </div>
        {resultSummary && (
          <div className="mb-2 text-muted-foreground text-sm">
            {resultSummary}
          </div>
        )}
        <SegmentGrid
          segments={segments}
          hiddenPaths={hiddenPaths}
          onEdit={handleEdit}
          onHide={handleHide}
          onUnhide={handleUnhide}
          onUndoSplit={handleUndoSplit}
          isDisabled={isBusy}
        />
      </section>

      {/* Fixed action bar — pinned to the bottom of the viewport.
          Shows hot links to flagged segments (too short / too tall) and
          Confirm/Discard buttons when there are pending staged changes.
          z-30 keeps it above page content but below the split editor modal
          (shadcn Dialog uses z-50). */}
      {showActionBar && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card shadow-[0_-2px_8px_rgba(0,0,0,0.15)]">
          <div className="mx-auto flex max-w-[1100px] flex-col gap-2 px-4 py-3">
            {/* Hot links row — scrollable pills linking to flagged segments */}
            {flaggedSegments.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                {flaggedSegments.some((f) => f.reason === "short") && (
                  <>
                    <span className="shrink-0 text-sky-400 text-xs font-medium">Short:</span>
                    {flaggedSegments
                      .filter((f) => f.reason === "short")
                      .map((f) => (
                        <button
                          key={f.idx}
                          type="button"
                          onClick={() =>
                            document
                              .getElementById(`segment-${f.idx}`)
                              ?.scrollIntoView({ behavior: "smooth", block: "end" })
                          }
                          className="shrink-0 rounded-full border border-sky-500/30 bg-sky-500/15 px-2.5 py-0.5 text-sky-400 text-xs transition-colors hover:bg-sky-500/25"
                        >
                          #{f.idx} &bull; {f.seg.height}px
                        </button>
                      ))}
                  </>
                )}
                {flaggedSegments.some((f) => f.reason === "tall") && (
                  <>
                    <span className="shrink-0 text-amber-400 text-xs font-medium">Tall:</span>
                    {flaggedSegments
                      .filter((f) => f.reason === "tall")
                      .map((f) => (
                        <button
                          key={f.idx}
                          type="button"
                          onClick={() =>
                            document
                              .getElementById(`segment-${f.idx}`)
                              ?.scrollIntoView({ behavior: "smooth", block: "end" })
                          }
                          className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-amber-400 text-xs transition-colors hover:bg-amber-500/25"
                        >
                          #{f.idx} &bull; {f.seg.height}px
                        </button>
                      ))}
                  </>
                )}
              </div>
            )}

            {/* Confirm / Discard row — always visible so the user can access
                actions without scrolling. Buttons are disabled when there are
                no pending changes to prevent accidental no-op confirms. */}
            <div className="flex items-center gap-3">
              {hasPendingChanges ? (
                <span className="text-sm">
                  Pending changes:
                  {hiddenCount > 0 && ` ${hiddenCount} hidden`}
                  {hiddenCount > 0 && splitCount > 0 && ","}
                  {splitCount > 0 && ` ${splitCount} split`}
                </span>
              ) : (
                <span className="text-muted-foreground text-sm">
                  {visibleSegments.length} visible / {segments.length} total
                </span>
              )}
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  disabled={isCommitting || !hasPendingChanges}
                  onClick={handleDiscard}
                  className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  type="button"
                  disabled={isCommitting || !hasPendingChanges}
                  onClick={handleConfirm}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 font-semibold text-sm text-white transition-colors hover:bg-emerald-700 disabled:pointer-events-none disabled:opacity-50"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Split editor modal — rendered conditionally based on editingSegment */}
      <SplitEditorModal
        segment={editingSegment}
        isOpen={editingSegment !== null}
        onClose={handleCloseEditor}
        onSave={handleSaveSplit}
      />
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: HomePage,
});
