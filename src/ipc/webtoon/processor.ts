/**
 * Image processing pipeline for the webtoon stitch-and-split workflow.
 *
 * Pure Node/Sharp module — no Electron imports. All functions run in the
 * main process, invoked by oRPC handlers in handlers.ts.
 *
 * Pipeline overview:
 *   1. Read images from a folder, sorted by numeric filename order
 *   2. Stitch them into one tall vertical strip (handling EXIF orientation)
 *   3. Scan the strip row-by-row to find large uniform-color gaps
 *   4. Split at the gaps to produce individual WebP lossless segments
 *   5. Capture gap colors (top/bottom of each removed strip) per segment
 *   6. Write a metadata.json sidecar with gap color info for the web app
 *   7. Optionally, manually split/merge segments after the fact
 *   8. Edge strips: manual splits extract 1px-tall PNG data URIs at interior
 *      boundaries for gradient rendering in the web reader
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  DEFAULT_COLOR_TOLERANCE,
  DEFAULT_MIN_GAP_HEIGHT,
} from "@/constants";

interface ProcessWebtoonInput {
  inputDir: string;
  outputDir: string;
  /** Override the default minimum gap height (px) for gap detection. */
  minGapHeight?: number;
  /** Override the default per-channel color tolerance for uniform row detection. */
  colorTolerance?: number;
}

interface SplitSegmentInput {
  filePath: string;
  breakpoints: number[];
  /**
   * When true, the original file is preserved on disk after splitting.
   * Used by the staged editing workflow so the original can be restored
   * if the user undoes the split before confirming.
   */
  keepOriginal?: boolean;
}

interface MergeSegmentsInput {
  filePaths: string[];
  outputPath: string;
}

interface ImageMeta {
  file: string;
  width: number;
  height: number;
}

interface Slice {
  top: number;
  height: number;
  /** Hex color of the bottom-most row of the gap above this slice, or null. */
  topGapColor: string | null;
  /** Hex color of the top-most row of the gap below this slice, or null. */
  bottomGapColor: string | null;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface UniformRun {
  start: number;
  end: number;
  /** Color of the first row in the run (reference pixel). */
  topColor: RgbColor;
  /** Color of the last row in the run (reference pixel). */
  bottomColor: RgbColor;
}

/**
 * Edge strip data for a single sub-segment produced by splitSegment.
 * Each field is a `data:image/png;base64,...` URI of a 1px-tall strip
 * capturing the pixel row at that boundary, or null for exterior edges
 * (where the parent's gap color or edge strip is inherited by the renderer).
 */
export interface EdgeStripData {
  topEdgeStrip: string | null;
  bottomEdgeStrip: string | null;
  topEdgeStripIsLight: boolean | null;
  bottomEdgeStripIsLight: boolean | null;
}

/**
 * Per-segment metadata returned by processWebtoon, pairing the written file
 * path with the gap colors extracted during the auto-split pipeline.
 * Edge strips are null for most auto-split segments; the first and last
 * segments get edge strips at the chapter boundaries (where gap color is null).
 */
export interface ProcessedSegment {
  filePath: string;
  topGapColor: string | null;
  bottomGapColor: string | null;
  topEdgeStrip: string | null;
  bottomEdgeStrip: string | null;
  topEdgeStripIsLight: boolean | null;
  bottomEdgeStripIsLight: boolean | null;
}

/**
 * Shape of a single entry in the metadata.json sidecar written alongside
 * segment WebP files. Used by the web app's admin upload flow to attach gap
 * colors and edge strip data to segment records in the database.
 */
export interface SegmentGapMeta {
  filename: string;
  topGapColor: string | null;
  bottomGapColor: string | null;
  /** data:image/png;base64 URI of the 1px-tall top content edge, or null. */
  topEdgeStrip: string | null;
  /** data:image/png;base64 URI of the 1px-tall bottom content edge, or null. */
  bottomEdgeStrip: string | null;
  /** Whether the top edge strip's average luminance is light (> 128). */
  topEdgeStripIsLight: boolean | null;
  /** Whether the bottom edge strip's average luminance is light (> 128). */
  bottomEdgeStripIsLight: boolean | null;
}

/**
 * processWebtoon is the main entry point for the automatic pipeline.
 *
 * Steps:
 *   1. Read and sort image files from inputDir
 *   2. Delete and recreate outputDir (destructive — previous results are wiped)
 *   3. Stitch all images into a single tall PNG
 *   4. Materialize to buffer then re-open — this guarantees a concrete pixel
 *      grid before the raw RGBA scan (avoids Sharp lazy-pipeline issues)
 *   5. Find uniform row runs, build slices from gaps, write segment WebP files
 *   6. Write metadata.json sidecar with per-segment gap colors
 *
 * @returns Per-segment metadata including file paths and gap colors.
 */
export async function processWebtoon({
  inputDir,
  outputDir,
  minGapHeight,
  colorTolerance,
}: ProcessWebtoonInput): Promise<ProcessedSegment[]> {
  const imagePaths = await readImagePaths(inputDir);
  if (!imagePaths.length) {
    throw new Error(`No images found in ${inputDir}`);
  }

  await resetOutputDir(outputDir);

  const stitched = await createStitchedImage(imagePaths);

  // Materialize the composite to a PNG buffer, then re-open it.
  // This forces Sharp to fully resolve the lazy composite pipeline before
  // we attempt a raw pixel read, avoiding "no pixels" errors.
  const stitchedBuffer = await stitched.png().toBuffer();
  const stitchedSharp = sharp(stitchedBuffer);

  // Extract raw RGBA pixel data for row-by-row gap analysis.
  // ensureAlpha() guarantees 4 channels even if the source was RGB.
  const { data, info } = await stitchedSharp
    .clone()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const uniformRuns = findUniformRowRuns(
    data,
    info.width,
    info.height,
    colorTolerance ?? DEFAULT_COLOR_TOLERANCE,
  );
  const slices = buildSlicesFromRuns(
    uniformRuns,
    info.height,
    minGapHeight ?? DEFAULT_MIN_GAP_HEIGHT,
  );

  const written = await writeSlices(
    stitchedSharp,
    slices,
    outputDir,
    info.width,
  );

  // Build ProcessedSegment results pairing file paths with gap colors.
  // Interior auto-split segments have proper gap colors from the removed
  // uniform bands, so edge strips are null for those.
  const segments: ProcessedSegment[] = written.map((filePath, i) => ({
    filePath,
    topGapColor: slices[i].topGapColor,
    bottomGapColor: slices[i].bottomGapColor,
    topEdgeStrip: null,
    bottomEdgeStrip: null,
    topEdgeStripIsLight: null,
    bottomEdgeStripIsLight: null,
  }));

  // Extract edge strips for the chapter boundary segments (first top,
  // last bottom) where gap color is null because no uniform gap was
  // removed at that boundary. These enable gradient rendering in the
  // web reader's column bottom gap and future column top gap.
  if (segments.length > 0) {
    const firstSlice = slices[0];
    const firstStrip = await extractEdgeStrip(
      stitchedSharp,
      firstSlice.top,
      info.width,
    );
    segments[0].topEdgeStrip = firstStrip.dataUri;
    segments[0].topEdgeStripIsLight = firstStrip.isLight;

    const lastSlice = slices[slices.length - 1];
    const lastRow = lastSlice.top + lastSlice.height - 1;
    const lastStrip = await extractEdgeStrip(
      stitchedSharp,
      lastRow,
      info.width,
    );
    segments[segments.length - 1].bottomEdgeStrip = lastStrip.dataUri;
    segments[segments.length - 1].bottomEdgeStripIsLight = lastStrip.isLight;
  }

  // Write metadata.json sidecar so the web app admin upload can read gap colors.
  await writeMetadataJson(outputDir, segments);

  return segments;
}

/**
 * Result of splitSegment: file paths for each sub-segment plus edge strip
 * data for interior boundaries (used for gradient gap rendering in the reader).
 */
export interface SplitSegmentResult {
  files: string[];
  /**
   * Parallel array to `files`. Each entry has the edge strip data for that
   * sub-segment. Interior boundaries get extracted pixel rows; exterior edges
   * (first-top, last-bottom) are null — the renderer fills those from the
   * parent segment's metadata (gap color or edge strip inheritance).
   */
  edgeStrips: EdgeStripData[];
}

/**
 * splitSegment splits a single image file at one or more horizontal breakpoints.
 *
 * Given N breakpoints, produces N+1 output files. Breakpoints are pixel offsets
 * from the top of the image, sorted ascending. Each slice is extracted with
 * sharp.extract() and written with a suffix like _a, _b, _c, etc.
 *
 * Unless `keepOriginal` is set, the original file is deleted after all slices
 * are written successfully. The staged editing workflow sets `keepOriginal`
 * so the original can be restored on undo without re-stitching.
 *
 * After writing slices, extracts 1px-tall PNG edge strips at interior split
 * boundaries (where gap colors will be null). These data URIs let the web
 * reader render gradient fade-outs instead of harsh black gaps.
 *
 * @returns File paths and per-sub-segment edge strip data.
 */
export async function splitSegment({
  filePath,
  breakpoints,
  keepOriginal,
}: SplitSegmentInput): Promise<SplitSegmentResult> {
  const meta = await sharp(filePath).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Unable to read image metadata.");
  }
  const { height, width } = meta;

  // Sort breakpoints so we can iterate top-to-bottom and validate bounds.
  const sorted = [...breakpoints].sort((a, b) => a - b);
  for (const bp of sorted) {
    if (bp <= 0 || bp >= height) {
      throw new Error(
        `Breakpoint ${bp} must be within image bounds (1..${height - 1}).`,
      );
    }
  }

  // edges = [0, bp1, bp2, ..., height] — defines N+1 vertical slices.
  const edges = [0, ...sorted, height];
  const dir = path.dirname(filePath);
  const { name } = path.parse(filePath);
  const stamp = Date.now();
  const suffixes = "abcdefghijklmnopqrstuvwxyz";

  const outputPaths: string[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const top = edges[i];
    const sliceHeight = edges[i + 1] - top;
    // Use letter suffixes (a, b, c, ...) for readability; fall back to index
    // if more than 26 slices (unlikely but safe).
    const suffix = i < suffixes.length ? suffixes[i] : String(i);
    // Always output WebP lossless regardless of the input format, so
    // splitting old PNG segments still produces WebP sub-segments.
    const outPath = path.join(dir, `${name}_${stamp}_${suffix}.webp`);
    await sharp(filePath)
      .extract({ left: 0, top, width, height: sliceHeight })
      .webp({ lossless: true })
      .toFile(outPath);
    outputPaths.push(outPath);
  }

  // Extract 1px-tall edge strips at interior split boundaries BEFORE
  // potentially deleting the source file. The source is needed for extraction.
  const numChildren = edges.length - 1;
  const sourceSharp = sharp(filePath);
  const edgeStrips: EdgeStripData[] = [];
  for (let i = 0; i < numChildren; i++) {
    // Exterior edges (first-top, last-bottom) are null — the renderer
    // inherits the parent's gap color or edge strip for those.
    const isFirst = i === 0;
    const isLast = i === numChildren - 1;
    const topResult = isFirst
      ? null
      : await extractEdgeStrip(sourceSharp, edges[i], width);
    const bottomResult = isLast
      ? null
      : await extractEdgeStrip(sourceSharp, edges[i + 1] - 1, width);
    edgeStrips.push({
      topEdgeStrip: topResult?.dataUri ?? null,
      bottomEdgeStrip: bottomResult?.dataUri ?? null,
      topEdgeStripIsLight: topResult?.isLight ?? null,
      bottomEdgeStripIsLight: bottomResult?.isLight ?? null,
    });
  }

  if (!keepOriginal) {
    await fs.rm(filePath, { force: true });
  }
  return { files: outputPaths, edgeStrips };
}

/**
 * mergeSegments stitches multiple image files back into a single vertical image.
 * This is the inverse of splitSegment — used for the "undo split" feature.
 *
 * All input files are resized to the widest file's width (preserving aspect ratio),
 * then composited top-to-bottom on a transparent RGBA canvas. The merged WebP
 * lossless file is written to outputPath and all input files are deleted.
 *
 * @returns The outputPath that was written.
 */
export async function mergeSegments({
  filePaths,
  outputPath,
}: MergeSegmentsInput): Promise<string> {
  if (filePaths.length < 2) {
    throw new Error("Need at least 2 files to merge.");
  }

  const metadata = await Promise.all(
    filePaths.map(async (file) => {
      const meta = await sharp(file).metadata();
      if (!meta.width || !meta.height) {
        throw new Error(`Missing dimensions for ${file}`);
      }
      return { file, width: meta.width, height: meta.height };
    }),
  );

  // Normalize all images to the widest width so they align horizontally.
  const targetWidth = Math.max(...metadata.map((m) => m.width));
  const composites: sharp.OverlayOptions[] = [];
  let totalHeight = 0;

  for (const m of metadata) {
    const { data, info } = await sharp(m.file)
      .resize({ width: targetWidth })
      .toBuffer({ resolveWithObject: true });
    composites.push({ input: data, top: totalHeight, left: 0 });
    totalHeight += info.height;
  }

  await sharp({
    create: {
      width: targetWidth,
      height: totalHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ lossless: true })
    .toFile(outputPath);

  for (const file of filePaths) {
    await fs.rm(file, { force: true });
  }

  return outputPath;
}

/**
 * readImagePaths lists image files in a directory, filtered to supported
 * extensions and sorted by numeric-aware basename comparison.
 * This ensures "2.png" sorts before "10.png".
 */
async function readImagePaths(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter(
      (entry) => entry.isFile() && /\.(png|webp|jpe?g)$/i.test(entry.name),
    )
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) =>
      path.basename(a).localeCompare(path.basename(b), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

/** Destructively resets a directory: delete everything, then recreate empty. */
async function resetOutputDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

/**
 * createStitchedImage composites all input images into one tall vertical strip.
 *
 * EXIF orientations 5-8 swap width and height, so we compute "oriented"
 * dimensions before determining the target width. Each image is auto-rotated
 * and resized to the widest input's width, then placed top-to-bottom on a
 * transparent RGBA canvas.
 */
async function createStitchedImage(
  imagePaths: string[],
): Promise<sharp.Sharp> {
  const metadata: ImageMeta[] = await Promise.all(
    imagePaths.map(async (file) => {
      const meta = await sharp(file).metadata();
      if (!meta.width || !meta.height) {
        throw new Error(`Missing dimensions for ${file}`);
      }
      // EXIF orientations 5-8 rotate 90/270 degrees, swapping width and height.
      const orientation = meta.orientation ?? 1;
      const orientedWidth =
        orientation >= 5 && orientation <= 8 ? meta.height : meta.width;
      const orientedHeight =
        orientation >= 5 && orientation <= 8 ? meta.width : meta.height;
      return { file, width: orientedWidth, height: orientedHeight };
    }),
  );

  const targetWidth = Math.max(...metadata.map((m) => m.width));
  const composites: sharp.OverlayOptions[] = [];
  let totalHeight = 0;

  for (const meta of metadata) {
    // .rotate() without arguments applies EXIF-based auto-rotation.
    const { data, info } = await sharp(meta.file)
      .rotate()
      .resize({ width: targetWidth })
      .toBuffer({ resolveWithObject: true });

    composites.push({ input: data, top: totalHeight, left: 0 });
    totalHeight += info.height;
  }

  return sharp({
    create: {
      width: targetWidth,
      height: totalHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites);
}

/**
 * findUniformRowRuns scans raw RGBA pixel data row-by-row and identifies
 * contiguous vertical runs where every row is "uniform" (single-color within
 * tolerance). Returns an array of { start, end, topColor, bottomColor } row
 * ranges, where topColor/bottomColor are the reference pixel of the first
 * and last rows of each run (used for gap coloring in the reader).
 */
function findUniformRowRuns(
  data: Buffer,
  width: number,
  height: number,
  tolerance: number,
): UniformRun[] {
  const runs: UniformRun[] = [];
  let runStart = -1;

  for (let y = 0; y < height; y += 1) {
    const uniform = isUniformRow(data, width, y, tolerance);
    if (uniform && runStart === -1) {
      runStart = y;
    }
    if (!uniform && runStart !== -1) {
      runs.push({
        start: runStart,
        end: y,
        topColor: getRowColor(data, width, runStart),
        bottomColor: getRowColor(data, width, y - 1),
      });
      runStart = -1;
    }
  }

  // Handle a run that extends to the bottom edge of the image.
  if (runStart !== -1) {
    runs.push({
      start: runStart,
      end: height,
      topColor: getRowColor(data, width, runStart),
      bottomColor: getRowColor(data, width, height - 1),
    });
  }

  return runs;
}

/**
 * buildSlicesFromRuns converts uniform row runs into content slices with
 * associated gap colors.
 *
 * Only runs taller than minGapHeight are treated as removable gaps.
 * Content between (and after) those gaps becomes output slices.
 * Short uniform runs are absorbed into the surrounding content.
 *
 * For each slice, topGapColor is the bottom-row color of the preceding gap
 * (the row closest to this slice's top edge), and bottomGapColor is the
 * top-row color of the following gap (the row closest to this slice's
 * bottom edge). These are stored so the web reader can render the original
 * gap color between adjacent segments.
 */
function buildSlicesFromRuns(
  runs: UniformRun[],
  imageHeight: number,
  minGapHeight: number,
): Slice[] {
  const slices: Slice[] = [];
  let cursor = 0;
  // Track the most recently skipped (removable) gap so we can assign its
  // bottomColor as the next slice's topGapColor.
  let lastGap: UniformRun | null = null;

  for (const run of runs) {
    const runHeight = run.end - run.start;
    if (runHeight < minGapHeight) {
      continue;
    }

    // Content from cursor to the start of this gap becomes a slice.
    if (run.start > cursor) {
      slices.push({
        top: cursor,
        height: run.start - cursor,
        topGapColor: lastGap ? rgbToHex(lastGap.bottomColor) : null,
        // bottomGapColor will be filled in by the next gap (or left null).
        bottomGapColor: rgbToHex(run.topColor),
      });
    }
    lastGap = run;
    // Advance cursor past the gap.
    cursor = run.end;
  }

  // Trailing content after the last gap.
  if (cursor < imageHeight) {
    slices.push({
      top: cursor,
      height: imageHeight - cursor,
      topGapColor: lastGap ? rgbToHex(lastGap.bottomColor) : null,
      bottomGapColor: null,
    });
  }

  return slices;
}

/** writeSlices extracts each slice from the stitched image and writes it as WebP lossless. */
async function writeSlices(
  stitched: sharp.Sharp,
  slices: Slice[],
  dir: string,
  width: number,
): Promise<string[]> {
  const files: string[] = [];
  let index = 0;
  for (const slice of slices) {
    if (slice.height <= 0) {
      continue;
    }
    const filename = `segment_${String(index).padStart(3, "0")}.webp`;
    const outPath = path.join(dir, filename);
    // .clone() is required because Sharp pipelines are consumed on first use.
    await stitched
      .clone()
      .extract({ left: 0, top: slice.top, width, height: slice.height })
      .webp({ lossless: true })
      .toFile(outPath);
    files.push(outPath);
    index += 1;
  }
  return files;
}

/**
 * Extracts the RGB color of the first pixel in a given row.
 * Used to capture the reference color of gap boundaries.
 */
function getRowColor(data: Buffer, width: number, rowIndex: number): RgbColor {
  const offset = rowIndex * width * 4;
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
}

/** Converts an RGB color to a lowercase hex string (e.g. "#ff00aa"). */
function rgbToHex({ r, g, b }: RgbColor): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Extracts a single pixel row from an image and encodes it as a PNG data URI,
 * plus computes the average perceived luminance to classify the strip as
 * light or dark. Used for gradient gap rendering in the web reader and
 * brightness-aware column bottom gap fill color selection.
 *
 * @param source - Sharp instance opened on the source image.
 * @param row - The 0-indexed row to extract.
 * @param width - Image width (determines the strip length).
 * @returns Data URI and brightness classification.
 */
async function extractEdgeStrip(
  source: sharp.Sharp,
  row: number,
  width: number,
): Promise<{ dataUri: string; isLight: boolean }> {
  const strip = source.clone().extract({ left: 0, top: row, width, height: 1 });
  const [pngBuffer, { data: rawPixels }] = await Promise.all([
    strip.clone().png().toBuffer(),
    strip.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  // Average perceived luminance using the standard Rec. 601 formula
  let totalLuminance = 0;
  for (let i = 0; i < rawPixels.length; i += 4) {
    totalLuminance +=
      0.299 * rawPixels[i] +
      0.587 * rawPixels[i + 1] +
      0.114 * rawPixels[i + 2];
  }
  const avgLuminance = totalLuminance / (rawPixels.length / 4);
  return {
    dataUri: `data:image/png;base64,${pngBuffer.toString("base64")}`,
    isLight: avgLuminance > 128,
  };
}

/**
 * Writes a metadata.json sidecar file in the output directory.
 * Maps each segment filename to its gap colors and edge strip data so the
 * web app's admin upload flow can attach them to segment DB records.
 */
export async function writeMetadataJson(
  outputDir: string,
  segments: ProcessedSegment[],
): Promise<void> {
  const entries: SegmentGapMeta[] = segments.map((seg) => ({
    filename: path.basename(seg.filePath),
    topGapColor: seg.topGapColor,
    bottomGapColor: seg.bottomGapColor,
    topEdgeStrip: seg.topEdgeStrip,
    bottomEdgeStrip: seg.bottomEdgeStrip,
    topEdgeStripIsLight: seg.topEdgeStripIsLight,
    bottomEdgeStripIsLight: seg.bottomEdgeStripIsLight,
  }));
  const json = JSON.stringify({ segments: entries }, null, 2);
  await fs.writeFile(path.join(outputDir, "metadata.json"), json, "utf-8");
}

/**
 * isUniformRow checks whether every pixel in a given row matches the first
 * pixel within the per-channel tolerance. Operates on raw RGBA buffer data
 * (4 bytes per pixel, row-major order).
 */
function isUniformRow(
  data: Buffer,
  width: number,
  rowIndex: number,
  tolerance: number,
): boolean {
  const start = rowIndex * width * 4;
  const end = start + width * 4;
  // Reference color: first pixel in the row.
  const r = data[start];
  const g = data[start + 1];
  const b = data[start + 2];
  const a = data[start + 3];

  // Compare every subsequent pixel against the reference.
  for (let i = start + 4; i < end; i += 4) {
    if (
      Math.abs(data[i] - r) > tolerance ||
      Math.abs(data[i + 1] - g) > tolerance ||
      Math.abs(data[i + 2] - b) > tolerance ||
      Math.abs(data[i + 3] - a) > tolerance
    ) {
      return false;
    }
  }

  return true;
}
