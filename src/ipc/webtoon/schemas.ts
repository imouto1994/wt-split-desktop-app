/**
 * Zod input schemas for the webtoon oRPC handlers.
 * These are validated automatically by oRPC before the handler runs.
 */
import z from "zod";

export const processWebtoonInputSchema = z.object({
  inputDir: z.string(),
  outputDir: z.string().optional(),
  /** Override the default min gap height (px) for gap detection. */
  minGapHeight: z.number().int().min(1).optional(),
  /** Override the default per-channel color tolerance (0-255) for uniform row detection. */
  colorTolerance: z.number().int().min(0).max(255).optional(),
});

export const splitSegmentInputSchema = z.object({
  filePath: z.string(),
  // Array of pixel positions (from top) where the image should be cut.
  // Must have at least 1 breakpoint. N breakpoints produce N+1 output files.
  breakpoints: z.array(z.number().int()).min(1),
  // When true, the original file is preserved on disk (staged editing workflow).
  keepOriginal: z.boolean().optional(),
});

export const mergeSegmentsInputSchema = z.object({
  // Ordered list of file paths to stitch vertically. Must have >= 2 files.
  filePaths: z.array(z.string()).min(2),
  outputPath: z.string(),
});

export const showInFolderInputSchema = z.object({
  filePath: z.string(),
});

/**
 * Input for batch-deleting files from disk.
 * Used by the staged editing workflow during Confirm, Discard, and undo-split.
 * Callers must guard with `filePaths.length > 0` before calling — .min(1)
 * rejects empty arrays to avoid a confusing no-op handler.
 */
export const deleteFilesInputSchema = z.object({
  filePaths: z.array(z.string()).min(1),
});

/** Input for writing/updating the metadata.json sidecar after mutations. */
export const writeMetadataInputSchema = z.object({
  outputDir: z.string(),
  segments: z.array(
    z.object({
      filename: z.string(),
      topGapColor: z.string().nullable(),
      bottomGapColor: z.string().nullable(),
      /** data:image/png;base64 URI of the 1px-tall top content edge, or null. */
      topEdgeStrip: z.string().nullable().optional(),
      /** data:image/png;base64 URI of the 1px-tall bottom content edge, or null. */
      bottomEdgeStrip: z.string().nullable().optional(),
      /** Whether the top edge strip's average luminance is light (> 128). */
      topEdgeStripIsLight: z.boolean().nullable().optional(),
      /** Whether the bottom edge strip's average luminance is light (> 128). */
      bottomEdgeStripIsLight: z.boolean().nullable().optional(),
    }),
  ),
});
