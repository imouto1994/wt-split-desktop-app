/**
 * Standalone smoke test for the processor refactor.
 *
 * Runs processWebtoon() against the bundled test fixture and verifies that
 * the produced segment WebPs are byte-identical to the reference output that
 * was committed when the OLD (PNG-roundtrip) architecture was used.
 *
 * If output diverges, the refactor changed pipeline behaviour beyond just
 * performance — investigate before merging.
 *
 * Usage:
 *   cd wt-split-desktop-app && npx tsx scripts/smoke-processor.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { processWebtoon } from "../src/ipc/webtoon/processor.ts";

// __dirname is provided by tsx's CJS compilation; import.meta.dirname is
// undefined in that mode, so we use __dirname for reliability.
const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const INPUT_DIR = path.join(REPO_ROOT, "test");
const REFERENCE_DIR = path.join(REPO_ROOT, "[Toonwide] test");
const SCRATCH_DIR = path.join(SCRIPT_DIR, "..", ".smoke-processor-out");

async function readSegmentFiles(dir: string): Promise<Map<string, Buffer>> {
  const entries = await fs.readdir(dir);
  const map = new Map<string, Buffer>();
  for (const name of entries.sort()) {
    if (!name.endsWith(".webp")) continue;
    map.set(name, await fs.readFile(path.join(dir, name)));
  }
  return map;
}

async function main(): Promise<void> {
  console.log(`Input dir:     ${INPUT_DIR}`);
  console.log(`Reference dir: ${REFERENCE_DIR}`);
  console.log(`Scratch dir:   ${SCRATCH_DIR}`);

  const start = Date.now();
  const segments = await processWebtoon({
    inputDir: INPUT_DIR,
    outputDir: SCRATCH_DIR,
    onProgress: (info) => {
      const detail = info.detail ? ` (${info.detail})` : "";
      const count =
        info.current !== undefined && info.total !== undefined
          ? ` [${info.current}/${info.total}]`
          : "";
      console.log(`  [${info.stage}]${count}${detail}`);
    },
  });
  const elapsed = Date.now() - start;
  console.log(`\nFinished: ${segments.length} segments in ${elapsed}ms`);

  const refFiles = await readSegmentFiles(REFERENCE_DIR);
  const newFiles = await readSegmentFiles(SCRATCH_DIR);

  console.log(`\nReference segments: ${refFiles.size}`);
  console.log(`New segments:       ${newFiles.size}`);

  if (refFiles.size !== newFiles.size) {
    console.error("\nSegment count differs! REGRESSION");
    process.exit(1);
  }

  let differences = 0;
  for (const [name, refBuf] of refFiles) {
    const newBuf = newFiles.get(name);
    if (!newBuf) {
      console.error(`  MISSING in new output: ${name}`);
      differences++;
      continue;
    }
    if (refBuf.equals(newBuf)) {
      console.log(`  ✓ identical: ${name} (${newBuf.length} B)`);
    } else {
      console.error(
        `  ✗ DIFFERS: ${name} (ref=${refBuf.length}B vs new=${newBuf.length}B)`,
      );
      differences++;
    }
  }

  if (differences > 0) {
    console.error(`\n${differences} file(s) differ from reference — REGRESSION`);
    process.exit(1);
  }
  console.log("\nAll segments byte-identical to reference — OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
