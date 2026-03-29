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

/** Runs the full stitch + auto-split pipeline. Returns { outputDir, files }. */
export function processWebtoon(payload: {
  inputDir: string;
  outputDir?: string;
}) {
  return ipc.client.webtoon.processWebtoon(payload);
}

/**
 * Splits a segment at the given breakpoints (pixel positions from top).
 * Returns { files } with N+1 paths. The original file is deleted.
 */
export function splitSegment(payload: {
  filePath: string;
  breakpoints: number[];
}) {
  return ipc.client.webtoon.splitSegment(payload);
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
