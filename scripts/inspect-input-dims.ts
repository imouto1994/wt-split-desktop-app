/**
 * Diagnostic script: lists every image in a folder with its raw and oriented
 * dimensions, plus what targetWidth our processor would compute.
 *
 * Run on the affected webtoon folder to find any image whose width differs
 * from the rest — that's the one driving the upscale.
 *
 * Usage:
 *   npx tsx scripts/inspect-input-dims.ts "/path/to/chapter/folder"
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

async function main(): Promise<void> {
  const inputDir = process.argv[2];
  if (!inputDir) {
    console.error("usage: npx tsx scripts/inspect-input-dims.ts <folder>");
    process.exit(1);
  }
  const entries = await fs.readdir(inputDir);
  const files = entries
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );

  console.log(
    "File".padEnd(40),
    "raw_w".padStart(7),
    "raw_h".padStart(7),
    "oriented_w".padStart(11),
    "oriented_h".padStart(11),
    "orientation".padStart(12),
  );
  const widths = new Map<number, number>();
  for (const f of files) {
    const m = await sharp(path.join(inputDir, f), {
      limitInputPixels: false,
    }).metadata();
    const o = m.orientation ?? 1;
    const ow = o >= 5 && o <= 8 ? m.height : m.width;
    const oh = o >= 5 && o <= 8 ? m.width : m.height;
    widths.set(ow ?? 0, (widths.get(ow ?? 0) ?? 0) + 1);
    console.log(
      f.padEnd(40),
      String(m.width).padStart(7),
      String(m.height).padStart(7),
      String(ow).padStart(11),
      String(oh).padStart(11),
      String(o).padStart(12),
    );
  }
  console.log("");
  console.log("Width distribution (oriented):");
  const sortedWidths = [...widths.entries()].sort((a, b) => a[0] - b[0]);
  for (const [w, count] of sortedWidths) {
    console.log(`  ${w}px : ${count} file(s)`);
  }
  const targetWidth = Math.max(...widths.keys());
  console.log("");
  console.log(`targetWidth (max) = ${targetWidth}px`);
  console.log(
    `Every image will be resized to ${targetWidth}px wide before stitching.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
