/**
 * oRPC handlers for the webtoon namespace.
 *
 * Each handler corresponds to a user-facing action in the renderer:
 *   pickInput / pickOutput  — native folder picker dialogs
 *   processWebtoon          — full stitch + auto-split pipeline
 *   splitSegment            — manual multi-breakpoint split
 *   mergeSegments           — undo a split by stitching files back together
 *   showInFolder            — reveal a file in the OS file manager
 *
 * Dialog handlers use ipcContext.mainWindowContext middleware to attach the
 * native dialog as a sheet on macOS (or modal on other platforms). Without
 * the parent BrowserWindow reference, the dialog may appear behind the app.
 */
import path from "node:path";
import { os } from "@orpc/server";
import { dialog, shell } from "electron";
import { ipcContext } from "../context";
import {
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
 */
export const processWebtoon = os
  .input(processWebtoonInputSchema)
  .handler(async ({ input }) => {
    const { inputDir, outputDir } = input;
    if (!inputDir) throw new Error("Input directory is required.");
    const finalOutput =
      outputDir ||
      path.join(path.dirname(inputDir), `[Toonwide] ${path.basename(inputDir)}`);
    const segments = await runProcessWebtoon({
      inputDir,
      outputDir: finalOutput,
    });
    return { outputDir: finalOutput, segments };
  });

/**
 * Manually splits a segment at user-defined breakpoints.
 * Accepts an array of pixel positions; produces N+1 output files.
 */
export const splitSegment = os
  .input(splitSegmentInputSchema)
  .handler(async ({ input }) => {
    const { filePath, breakpoints } = input;
    if (!filePath) {
      throw new Error("filePath is required.");
    }
    const files = await runSplitSegment({ filePath, breakpoints });
    return { files };
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

/** Reveals a file in the OS file manager (Finder on macOS, Explorer on Windows). */
export const showInFolder = os
  .input(showInFolderInputSchema)
  .handler(({ input }) => {
    shell.showItemInFolder(input.filePath);
  });

/**
 * Writes/overwrites metadata.json in the output directory with the current
 * segment gap color state. Called after processWebtoon (automatic), and after
 * splitSegment / mergeSegments (manual) to keep the sidecar in sync.
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
      })),
    );
  });
