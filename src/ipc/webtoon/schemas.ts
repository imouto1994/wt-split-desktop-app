/**
 * Zod input schemas for the webtoon oRPC handlers.
 * These are validated automatically by oRPC before the handler runs.
 */
import z from "zod";

export const processWebtoonInputSchema = z.object({
  inputDir: z.string(),
  outputDir: z.string().optional(),
});

export const splitSegmentInputSchema = z.object({
  filePath: z.string(),
  // Array of pixel positions (from top) where the image should be cut.
  // Must have at least 1 breakpoint. N breakpoints produce N+1 output files.
  breakpoints: z.array(z.number().int()).min(1),
});

export const mergeSegmentsInputSchema = z.object({
  // Ordered list of file paths to stitch vertically. Must have >= 2 files.
  filePaths: z.array(z.string()).min(2),
  outputPath: z.string(),
});

export const showInFolderInputSchema = z.object({
  filePath: z.string(),
});
