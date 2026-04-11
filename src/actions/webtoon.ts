/**
 * Renderer-side action wrappers for the webtoon oRPC namespace.
 *
 * These thin functions decouple React components from the oRPC client shape,
 * providing a clean import boundary. Each function maps 1:1 to an oRPC handler
 * on the main process side (src/ipc/webtoon/handlers.ts).
 */
import { ipc } from "@/ipc/manager";

/** Opens the native directory picker for the input folder. Returns path or null. */
export function pickInputFolder() {
  return ipc.client.webtoon.pickInput();
}

/** Opens the native directory picker for the output folder. Returns path or null. */
export function pickOutputFolder() {
  return ipc.client.webtoon.pickOutput();
}

/**
 * Runs the full stitch + auto-split pipeline. Returns { outputDir, segments }.
 * Optionally accepts overrides for the gap-detection parameters.
 */
export function processWebtoon(payload: {
  inputDir: string;
  outputDir?: string;
  minGapHeight?: number;
  colorTolerance?: number;
}) {
  return ipc.client.webtoon.processWebtoon(payload);
}

/**
 * Splits a segment at the given breakpoints (pixel positions from top).
 * Returns { files, edgeStrips } with N+1 paths and per-sub-segment edge
 * strip data (1px-tall PNG data URIs at interior boundaries) for gradient
 * gap rendering. When `keepOriginal` is true, the original file is
 * preserved for the staged editing workflow.
 */
export function splitSegment(payload: {
  filePath: string;
  breakpoints: number[];
  keepOriginal?: boolean;
}) {
  return ipc.client.webtoon.splitSegment(payload);
}

/**
 * Batch-deletes files from disk. Used by staged editing for Confirm,
 * Discard, and undo-split cleanup. Returns { failed } with paths that
 * could not be deleted (e.g. locked by another process on Windows).
 * Callers must guard with `filePaths.length > 0` before calling.
 */
export function deleteFiles(filePaths: string[]) {
  return ipc.client.webtoon.deleteFiles({ filePaths });
}

/**
 * Merges multiple segment files back into one (undo split).
 * Files are stitched vertically in order. All input files are deleted.
 * Returns { file } with the merged output path.
 */
export function mergeSegments(payload: {
  filePaths: string[];
  outputPath: string;
}) {
  return ipc.client.webtoon.mergeSegments(payload);
}

/** Reveals a file in the OS file manager (Finder on macOS, Explorer on Windows). */
export function showInFolder(filePath: string) {
  return ipc.client.webtoon.showInFolder({ filePath });
}

/**
 * Writes/overwrites metadata.json in the output directory with the current
 * segment gap color and edge strip state. Called on Confirm to finalize
 * staged edits.
 */
export function writeMetadata(payload: {
  outputDir: string;
  segments: {
    filename: string;
    topGapColor: string | null;
    bottomGapColor: string | null;
    topEdgeStrip?: string | null;
    bottomEdgeStrip?: string | null;
    topEdgeStripIsLight?: boolean | null;
    bottomEdgeStripIsLight?: boolean | null;
  }[];
}) {
  return ipc.client.webtoon.writeMetadata(payload);
}
