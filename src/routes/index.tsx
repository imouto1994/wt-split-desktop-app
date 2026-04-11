/**
 * Main page — the single route for the webtoon processor UI.
 *
 * Manages all application state and wires together the folder pickers,
 * process button, status display, segment list/grid, and split editor.
 *
 * Data flow:
 *   1. User picks input (and optionally output) folder
 *   2. User clicks Process → calls processWebtoon IPC → gets back file paths
 *   3. loadSegmentMetadata loads dimensions for each file using new Image()
 *   4. Segments render in a list and grid
 *   5. User can Edit (split) or Undo (merge) segments from the grid
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import {
  mergeSegments,
  pickInputFolder,
  pickOutputFolder,
  processWebtoon,
  splitSegment,
  writeMetadata,
} from "@/actions/webtoon";
import FolderPicker from "@/components/webtoon/folder-picker";
import SegmentGrid from "@/components/webtoon/segment-grid";
import SegmentList from "@/components/webtoon/segment-list";
import SplitEditorModal from "@/components/webtoon/split-editor-modal";
import StatusDisplay from "@/components/webtoon/status-display";
import { type SegmentMeta, toLocalFileUrl } from "@/components/webtoon/types";

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
 */
function loadSegmentMetadata(
  files: string[],
  opts?: {
    splitGroup?: string;
    splitOriginalPath?: string;
    gapColors?: { topGapColor: string | null; bottomGapColor: string | null }[];
  },
): Promise<SegmentMeta[]> {
  return Promise.all(
    files.map(
      (file, i) =>
        new Promise<SegmentMeta>((resolve) => {
          const colors = opts?.gapColors?.[i];
          const img = new Image();
          img.onload = () =>
            resolve({
              path: file,
              width: img.naturalWidth || 0,
              height: img.naturalHeight || 0,
              topGapColor: colors?.topGapColor ?? null,
              bottomGapColor: colors?.bottomGapColor ?? null,
              splitGroup: opts?.splitGroup,
              splitOriginalPath: opts?.splitOriginalPath,
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
              splitGroup: opts?.splitGroup,
              splitOriginalPath: opts?.splitOriginalPath,
            });
          img.src = toLocalFileUrl(file);
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

function HomePage() {
  const [inputDir, setInputDir] = useState("");
  const [outputDir, setOutputDir] = useState("");
  /** The resolved output directory from the last processWebtoon run. */
  const [resolvedOutputDir, setResolvedOutputDir] = useState("");
  const [segments, setSegments] = useState<SegmentMeta[]>([]);
  const [resultSummary, setResultSummary] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusMode, setStatusMode] = useState<StatusMode>("info");
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingSegment, setEditingSegment] = useState<SegmentMeta | null>(
    null,
  );

  const setStatus = useCallback(
    (message: string, mode: StatusMode = "info") => {
      setStatusMessage(message);
      setStatusMode(mode);
    },
    [],
  );

  /**
   * Writes metadata.json to the output directory with the current segment
   * gap color state. Fire-and-forget — failures are logged but not surfaced.
   * Uses the oRPC writeMetadata handler which runs in the main process.
   */
  const syncMetadata = useCallback(
    (segs: SegmentMeta[], outDir: string) => {
      if (!outDir) return;
      writeMetadata({
        outputDir: outDir,
        segments: segs.map((s) => ({
          // Extract filename from absolute path; renderer can't use node:path.
          filename: s.path.split(/[\\/]/).pop()!,
          topGapColor: s.topGapColor,
          bottomGapColor: s.bottomGapColor,
        })),
      }).catch(() => {
        // Best-effort sync; failing silently is acceptable here.
      });
    },
    [],
  );

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

  /**
   * Runs the full stitch + auto-split pipeline.
   * Clears all previous state before starting so the UI doesn't show stale data.
   */
  const handleProcess = useCallback(async () => {
    if (!inputDir) {
      setStatus("Please choose an input folder first.", "warn");
      return;
    }

    setStatus("Processing\u2026");
    setResultSummary("");
    setSegments([]);
    setIsProcessing(true);

    try {
      const res = await processWebtoon({
        inputDir,
        outputDir: outputDir || undefined,
      });
      const { segments: processed, outputDir: resolvedOutput } = res;
      setStatus(`Done. Wrote ${processed.length} files.`, "ok");
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
      setSegments(sortSegments(metas));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${message}`, "error");
    } finally {
      setIsProcessing(false);
    }
  }, [inputDir, outputDir, setStatus]);

  const handleEdit = useCallback((segment: SegmentMeta) => {
    setEditingSegment(segment);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setEditingSegment(null);
  }, []);

  /**
   * Called when the split editor saves. Sends breakpoints to the main process,
   * then replaces the original segment in state with the newly created slices.
   * All new slices share a splitGroup ID so they can be merged back later.
   *
   * Gap color inheritance: the first child gets the parent's topGapColor,
   * the last child gets the parent's bottomGapColor, middle children get null.
   * This is done here (not in the processor) because splitSegment is a pure
   * Sharp function unaware of gap color metadata.
   */
  const handleSaveSplit = useCallback(
    async (filePath: string, breakpointsPx: number[]) => {
      try {
        setStatus("Splitting segment\u2026");
        const parent = segments.find((s) => s.path === filePath);
        const res = await splitSegment({ filePath, breakpoints: breakpointsPx });
        // Tag all new sub-segments with a shared group ID and remember the
        // original path so merging can restore the filename and sort position.
        const groupId = `split_${Date.now()}`;
        const numChildren = res.files.length;
        const gapColors = res.files.map((_, i) => ({
          topGapColor: i === 0 ? (parent?.topGapColor ?? null) : null,
          bottomGapColor:
            i === numChildren - 1 ? (parent?.bottomGapColor ?? null) : null,
        }));
        const newMetas = await loadSegmentMetadata(res.files, {
          splitGroup: groupId,
          splitOriginalPath: filePath,
          gapColors,
        });
        const updated = sortSegments(
          segments.filter((s) => s.path !== filePath).concat(newMetas),
        );
        setSegments(updated);
        syncMetadata(updated, resolvedOutputDir);
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
    [setStatus, segments, syncMetadata, resolvedOutputDir],
  );

  /**
   * Merges all segments in a split group back into one file.
   * Writes the merged output to the original pre-split filename so it
   * sorts back to its original position among siblings.
   *
   * Gap color restoration: the merged segment recovers topGapColor from
   * the first child and bottomGapColor from the last child, restoring
   * the original gap color state from before the split.
   */
  const handleMerge = useCallback(
    async (groupId: string) => {
      const groupSegments = sortSegments(
        segments.filter((s) => s.splitGroup === groupId),
      );
      if (groupSegments.length < 2) return;

      try {
        setStatus("Merging segments\u2026");

        // Restore the original filename so the merged file sorts to the
        // same position it had before the split. Fall back to a timestamped
        // name if the original path wasn't tracked (shouldn't happen).
        // Always use .webp extension — if the original was .png (pre-WebP update),
        // swap the extension so the merge output matches the current format.
        const originalPath = groupSegments[0].splitOriginalPath;
        const dir = groupSegments[0].path.substring(0, groupSegments[0].path.lastIndexOf("/"));
        const outputPath = originalPath
          ? originalPath.replace(/\.[^.]+$/, ".webp")
          : `${dir}/merged_${Date.now()}.webp`;

        const filePaths = groupSegments.map((s) => s.path);

        await mergeSegments({ filePaths, outputPath });
        // Recover gap colors: first child's top + last child's bottom.
        const restoredGapColors = [
          {
            topGapColor: groupSegments[0].topGapColor,
            bottomGapColor: groupSegments[groupSegments.length - 1].bottomGapColor,
          },
        ];
        const newMetas = await loadSegmentMetadata([outputPath], {
          gapColors: restoredGapColors,
        });
        const groupPaths = new Set(filePaths);
        const updated = sortSegments(
          segments.filter((s) => !groupPaths.has(s.path)).concat(newMetas),
        );
        setSegments(updated);
        syncMetadata(updated, resolvedOutputDir);
        setStatus("Merged back into 1 segment.", "ok");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(`Error: ${message}`, "error");
      }
    },
    [segments, setStatus, syncMetadata, resolvedOutputDir],
  );

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
      {/* Controls section: folder pickers + process button */}
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
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleProcess}
              className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/80 disabled:pointer-events-none disabled:opacity-50"
            >
              Process
            </button>
            <StatusDisplay message={statusMessage} mode={statusMode} />
          </div>
        </div>
      </section>

      {/* Results section: segment list + thumbnail grid */}
      <section className="rounded-xl border border-border bg-card p-4 shadow-lg">
        <h2 className="mb-2 font-bold text-lg">Generated Segments</h2>
        {resultSummary && (
          <div className="mb-2 text-muted-foreground text-sm">
            {resultSummary}
          </div>
        )}
        <SegmentList segments={segments} />
        <div className="mt-3">
          <SegmentGrid
            segments={segments}
            onEdit={handleEdit}
            onMerge={handleMerge}
          />
        </div>
      </section>

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
