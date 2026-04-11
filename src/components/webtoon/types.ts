/** Metadata for a single output segment, loaded from the filesystem. */
export interface SegmentMeta {
  path: string;
  width: number;
  height: number;
  /**
   * Hex color of the bottom-most row of the gap that was removed above
   * this segment during auto-split, or null if no gap was above it.
   * Used by the web app reader to color the gap between segments.
   */
  topGapColor: string | null;
  /**
   * Hex color of the top-most row of the gap that was removed below
   * this segment during auto-split, or null if no gap was below it.
   */
  bottomGapColor: string | null;
  /**
   * data:image/png;base64 URI of a 1px-tall PNG capturing the top pixel row
   * of this segment's content. Present at interior split boundaries (where
   * topGapColor is null) so the web reader can render a gradient fade-out.
   * For nested splits, the first child inherits the parent's topEdgeStrip.
   */
  topEdgeStrip?: string | null;
  /** Whether the top edge strip's average luminance is light (> 128). */
  topEdgeStripIsLight?: boolean | null;
  /**
   * data:image/png;base64 URI of a 1px-tall PNG capturing the bottom pixel row
   * of this segment's content. Present at interior split boundaries (where
   * bottomGapColor is null) so the web reader can render a gradient fade-out.
   * For nested splits, the last child inherits the parent's bottomEdgeStrip.
   */
  bottomEdgeStrip?: string | null;
  /** Whether the bottom edge strip's average luminance is light (> 128). */
  bottomEdgeStripIsLight?: boolean | null;
  /**
   * When a segment is produced by a manual split, all sibling sub-segments
   * share the same splitGroup ID. This enables the "undo split" feature —
   * clicking merge on any member re-stitches the entire group.
   * Segments from the initial auto-split pipeline have no splitGroup.
   */
  splitGroup?: string;
  /**
   * The absolute path of the original segment before it was split.
   * Stored so that merging (undo) can write the output back to the
   * original filename, preserving its sort position among siblings.
   */
  splitOriginalPath?: string;
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
