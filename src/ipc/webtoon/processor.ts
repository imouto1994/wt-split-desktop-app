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
 *   4. Split at the gaps to produce individual PNG segments
 *   5. Optionally, manually split/merge segments after the fact
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Contiguous uniform rows shorter than this are kept as part of the content.
// Only runs >= 100px tall are treated as removable gaps between segments.
const MIN_GAP_HEIGHT = 100;

// Per-channel (R, G, B, A) tolerance when deciding if a row is "uniform."
// A value of 10 accommodates JPEG artifacts and slight color gradients in
// backgrounds that should still count as blank space.
const COLOR_TOLERANCE = 10;

interface ProcessWebtoonInput {
  inputDir: string;
  outputDir: string;
}

interface SplitSegmentInput {
  filePath: string;
  breakpoints: number[];
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
}

interface UniformRun {
  start: number;
  end: number;
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
 *   5. Find uniform row runs, build slices from gaps, write segment PNGs
 *
 * @returns Absolute paths to all written segment files.
 */
export async function processWebtoon({
  inputDir,
  outputDir,
}: ProcessWebtoonInput): Promise<string[]> {
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
    COLOR_TOLERANCE,
  );
  const slices = buildSlicesFromRuns(uniformRuns, info.height, MIN_GAP_HEIGHT);

  const written = await writeSlices(
    stitchedSharp,
    slices,
    outputDir,
    info.width,
  );
  return written;
}

/**
 * splitSegment splits a single image file at one or more horizontal breakpoints.
 *
 * Given N breakpoints, produces N+1 output files. Breakpoints are pixel offsets
 * from the top of the image, sorted ascending. Each slice is extracted with
 * sharp.extract() and written with a suffix like _a, _b, _c, etc.
 *
 * The original file is deleted after all slices are written successfully.
 *
 * @returns Absolute paths to all newly created slice files.
 */
export async function splitSegment({
  filePath,
  breakpoints,
}: SplitSegmentInput): Promise<string[]> {
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
  const { name, ext } = path.parse(filePath);
  const stamp = Date.now();
  const suffixes = "abcdefghijklmnopqrstuvwxyz";

  const outputPaths: string[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const top = edges[i];
    const sliceHeight = edges[i + 1] - top;
    // Use letter suffixes (a, b, c, ...) for readability; fall back to index
    // if more than 26 slices (unlikely but safe).
    const suffix = i < suffixes.length ? suffixes[i] : String(i);
    const outPath = path.join(dir, `${name}_${stamp}_${suffix}${ext}`);
    await sharp(filePath)
      .extract({ left: 0, top, width, height: sliceHeight })
      .toFile(outPath);
    outputPaths.push(outPath);
  }

  await fs.rm(filePath, { force: true });
  return outputPaths;
}

/**
 * mergeSegments stitches multiple image files back into a single vertical image.
 * This is the inverse of splitSegment — used for the "undo split" feature.
 *
 * All input files are resized to the widest file's width (preserving aspect ratio),
 * then composited top-to-bottom on a transparent RGBA canvas. The merged PNG is
 * written to outputPath and all input files are deleted.
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
    .png()
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
 * tolerance). Returns an array of { start, end } row ranges.
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
      runs.push({ start: runStart, end: y });
      runStart = -1;
    }
  }

  // Handle a run that extends to the bottom edge of the image.
  if (runStart !== -1) {
    runs.push({ start: runStart, end: height });
  }

  return runs;
}

/**
 * buildSlicesFromRuns converts uniform row runs into content slices.
 *
 * Only runs taller than minGapHeight are treated as removable gaps.
 * Content between (and after) those gaps becomes output slices.
 * Short uniform runs are absorbed into the surrounding content.
 */
function buildSlicesFromRuns(
  runs: UniformRun[],
  imageHeight: number,
  minGapHeight: number,
): Slice[] {
  const slices: Slice[] = [];
  let cursor = 0;

  for (const run of runs) {
    const runHeight = run.end - run.start;
    if (runHeight < minGapHeight) {
      continue;
    }

    // Content from cursor to the start of this gap becomes a slice.
    if (run.start > cursor) {
      slices.push({ top: cursor, height: run.start - cursor });
    }
    // Advance cursor past the gap.
    cursor = run.end;
  }

  // Trailing content after the last gap.
  if (cursor < imageHeight) {
    slices.push({ top: cursor, height: imageHeight - cursor });
  }

  return slices;
}

/** writeSlices extracts each slice from the stitched image and writes it as a PNG. */
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
    const filename = `segment_${String(index).padStart(3, "0")}.png`;
    const outPath = path.join(dir, filename);
    // .clone() is required because Sharp pipelines are consumed on first use.
    await stitched
      .clone()
      .extract({ left: 0, top: slice.top, width, height: slice.height })
      .toFile(outPath);
    files.push(outPath);
    index += 1;
  }
  return files;
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
