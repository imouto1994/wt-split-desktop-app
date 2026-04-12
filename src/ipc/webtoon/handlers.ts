/**
 * oRPC handlers for the webtoon namespace.
 *
 * Each handler corresponds to a user-facing action in the renderer:
 *   pickInput / pickOutput  — native folder picker dialogs
 *   processWebtoon          — full stitch + auto-split pipeline
 *   splitSegment            — manual multi-breakpoint split
 *   mergeSegments           — undo a split by stitching files back together
 *   deleteFiles             — batch-delete files (staged editing cleanup)
 *   showInFolder            — reveal a file in the OS file manager
 *
 * Dialog handlers use ipcContext.mainWindowContext middleware to attach the
 * native dialog as a sheet on macOS (or modal on other platforms). Without
 * the parent BrowserWindow reference, the dialog may appear behind the app.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { os } from "@orpc/server";
import { dialog, shell } from "electron";
import { IPC_CHANNELS } from "@/constants";
import { ipcContext } from "../context";
import {
  deleteFilesInputSchema,
  mergeSegmentsInputSchema,
  processWebtoonInputSchema,
  showInFolderInputSchema,
  splitSegmentInputSchema,
  writeMetadataInputSchema,
} from "./schemas";
import {
  mergeSegments as runMergeSegments,
  processWebtoon as runProcessWebtoon,
  splitSegment as runSplitSegment,
  writeMetadataJson,
} from "./processor";

/** Opens a native directory picker for the input folder. */
export const pickInput = os
  .use(ipcContext.mainWindowContext)
  .handler(async ({ context }) => {
    const res = await dialog.showOpenDialog(context.window, {
      properties: ["openDirectory"],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

/**
 * Opens a native directory picker for the output folder.
 * "createDirectory" allows the user to create new folders inline on macOS.
 */
export const pickOutput = os
  .use(ipcContext.mainWindowContext)
  .handler(async ({ context }) => {
    const res = await dialog.showOpenDialog(context.window, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

/**
 * Runs the full stitch + auto-split pipeline.
 * If outputDir is omitted, defaults to a sibling folder named
 * `[Toonwide] <inputDirName>` next to the input directory.
 * This convention aligns with the web app's batch chapter import:
 * the admin selects the parent folder and each `[Toonwide] *` sub-folder
 * becomes an importable chapter.
 * Returns per-segment metadata including gap colors from removed strips.
 *
 * Uses mainWindowContext to push stage-aware progress events (stitching,
 * analyzing, writing, finalizing) to the renderer via Electron IPC,
 * separate from the oRPC request/response channel which doesn't support
 * streaming.
 */
export const processWebtoon = os
  .use(ipcContext.mainWindowContext)
  .input(processWebtoonInputSchema)
  .handler(async ({ input, context }) => {
    const { inputDir, outputDir, minGapHeight, colorTolerance } = input;
    if (!inputDir) throw new Error("Input directory is required.");
    const finalOutput =
      outputDir ||
      path.join(path.dirname(inputDir), `[Toonwide] ${path.basename(inputDir)}`);
    const segments = await runProcessWebtoon({
      inputDir,
      outputDir: finalOutput,
      minGapHeight,
      colorTolerance,
      onProgress: (info) => {
        // Guard: the window may be closed while processing is in-flight.
        // webContents.send on a destroyed window throws.
        if (!context.window.isDestroyed()) {
          context.window.webContents.send(
            IPC_CHANNELS.PROCESSING_PROGRESS,
            info,
          );
        }
      },
    });
    return { outputDir: finalOutput, segments };
  });

/**
 * Manually splits a segment at user-defined breakpoints.
 * Accepts an array of pixel positions; produces N+1 output files.
 * When `keepOriginal` is true, the original file is preserved on disk
 * for the staged editing workflow (undo without re-stitching).
 *
 * Returns file paths plus per-sub-segment edge strip data (1px-tall PNG
 * data URIs at interior boundaries) for gradient gap rendering.
 */
export const splitSegment = os
  .input(splitSegmentInputSchema)
  .handler(async ({ input }) => {
    const { filePath, breakpoints, keepOriginal } = input;
    if (!filePath) {
      throw new Error("filePath is required.");
    }
    const { files, edgeStrips } = await runSplitSegment({
      filePath,
      breakpoints,
      keepOriginal,
    });
    return { files, edgeStrips };
  });

/**
 * Merges multiple segment files back into one (undo split).
 * Files are stitched vertically in the order provided.
 */
export const mergeSegments = os
  .input(mergeSegmentsInputSchema)
  .handler(async ({ input }) => {
    const { filePaths, outputPath } = input;
    const file = await runMergeSegments({ filePaths, outputPath });
    return { file };
  });

/**
 * Batch-deletes files from disk. Used by the staged editing workflow:
 *   - Confirm: deletes hidden segment files and replaced split originals
 *   - Discard: deletes staged split children to restore the base state
 *   - Undo split: deletes child files so the original can be restored
 *
 * Uses `force: true` to suppress ENOENT (file already deleted externally).
 * Other errors (EACCES, EPERM) are collected and reported so the caller
 * knows which files couldn't be removed.
 */
export const deleteFiles = os
  .input(deleteFilesInputSchema)
  .handler(async ({ input }) => {
    const failed: string[] = [];
    for (const filePath of input.filePaths) {
      try {
        await fs.rm(filePath, { force: true });
      } catch {
        failed.push(filePath);
      }
    }
    return { failed };
  });

/** Reveals a file in the OS file manager (Finder on macOS, Explorer on Windows). */
export const showInFolder = os
  .input(showInFolderInputSchema)
  .handler(({ input }) => {
    shell.showItemInFolder(input.filePath);
  });

/**
 * Writes/overwrites metadata.json in the output directory with the current
 * segment gap color and edge strip state. Called on Confirm to finalize
 * staged edits, and after processWebtoon for the initial auto-split.
 */
export const writeMetadata = os
  .input(writeMetadataInputSchema)
  .handler(async ({ input }) => {
    const { outputDir, segments } = input;
    await writeMetadataJson(
      outputDir,
      segments.map((s) => ({
        filePath: path.join(outputDir, s.filename),
        topGapColor: s.topGapColor ?? null,
        bottomGapColor: s.bottomGapColor ?? null,
        topEdgeStrip: s.topEdgeStrip ?? null,
        bottomEdgeStrip: s.bottomEdgeStrip ?? null,
        topEdgeStripIsLight: s.topEdgeStripIsLight ?? null,
        bottomEdgeStripIsLight: s.bottomEdgeStripIsLight ?? null,
      })),
    );
  });
