/**
 * Composes all webtoon handlers into a single namespace object
 * that gets registered on the oRPC router in src/ipc/router.ts.
 *
 * The renderer calls these as ipc.client.webtoon.<handler>(...).
 */
import {
  deleteFiles,
  mergeSegments,
  pickInput,
  pickOutput,
  processWebtoon,
  showInFolder,
  splitSegment,
  writeMetadata,
} from "./handlers";

export const webtoon = {
  pickInput,
  pickOutput,
  processWebtoon,
  splitSegment,
  mergeSegments,
  deleteFiles,
  showInFolder,
  writeMetadata,
};
