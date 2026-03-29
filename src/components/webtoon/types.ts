/** Metadata for a single output segment, loaded from the filesystem. */
export interface SegmentMeta {
  path: string;
  width: number;
  height: number;
  /**
   * When a segment is produced by a manual split, all sibling sub-segments
   * share the same splitGroup ID. This enables the "undo split" feature —
   * clicking merge on any member re-stitches the entire group.
   * Segments from the initial auto-split pipeline have no splitGroup.
   */
  splitGroup?: string;
}

/**
 * Converts an absolute filesystem path to a local-file:// URL that the
 * renderer can use in <img src>, new Image(), etc.
 *
 * The "localhost" host is required because the scheme is registered as
 * "standard" in Electron. Without it, Chromium's URL parser would eat the
 * first path component (e.g., "Users") as the hostname, producing a
 * truncated pathname.
 *
 * Example: /Users/foo/segment.png → local-file://localhost/Users/foo/segment.png
 */
export function toLocalFileUrl(absolutePath: string): string {
  return `local-file://localhost${absolutePath}`;
}
