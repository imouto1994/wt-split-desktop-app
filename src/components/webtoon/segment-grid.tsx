/**
 * Responsive grid of segment thumbnail cards.
 *
 * Each card shows:
 *   - Lazy-loaded image thumbnail via the local-file:// custom protocol
 *   - Index number and pixel height
 *   - "Open" button to reveal the file in the OS file manager
 *   - "Edit" button (if the aspect ratio exceeds the threshold) to open the
 *     multi-line split editor
 *   - "Undo split" button (if the segment belongs to a split group) to merge
 *     all siblings back into one file
 */
import { Undo2 } from "lucide-react";
import { showInFolder } from "@/actions/webtoon";
import { Button } from "@/components/ui/button";
import { type SegmentMeta, toLocalFileUrl } from "./types";

// Segments with height/width ratio above this show the Edit button.
// A ratio of 3 means the image is at least 3x taller than it is wide,
// which is a reasonable heuristic for "too tall and needs manual splitting."
const EDIT_ASPECT_RATIO_THRESHOLD = 3;

interface SegmentGridProps {
  segments: SegmentMeta[];
  onEdit: (segment: SegmentMeta) => void;
  onMerge: (groupId: string) => void;
}

function needsEdit(seg: SegmentMeta): boolean {
  return seg.width > 0 && seg.height / seg.width > EDIT_ASPECT_RATIO_THRESHOLD;
}

export default function SegmentGrid({
  segments,
  onEdit,
  onMerge,
}: SegmentGridProps) {
  if (!segments.length) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {segments.map((seg, idx) => (
        <div
          key={seg.path}
          className="overflow-hidden rounded-lg border border-border bg-background"
        >
          <img
            loading="lazy"
            src={toLocalFileUrl(seg.path)}
            alt={`Segment ${idx}`}
            className="block w-full"
          />
          <div className="flex flex-col gap-1 p-2 text-muted-foreground text-sm">
            <div className="flex items-center justify-between">
              <span>
                #{idx} &bull; {seg.height}px
              </span>
              <div className="flex items-center gap-2">
                {/* Reveals the file in Finder/Explorer instead of navigating the window */}
                <button
                  type="button"
                  onClick={() => showInFolder(seg.path)}
                  className="font-semibold text-emerald-400 no-underline hover:underline"
                >
                  Open
                </button>
                {needsEdit(seg) && (
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => onEdit(seg)}
                  >
                    Edit
                  </Button>
                )}
              </div>
            </div>
            {/* Gap color swatches — each swatch only renders when its
                specific color is non-null, avoiding confusion where a null
                fallback to black looks identical to an actual #000000. */}
            {(seg.topGapColor || seg.bottomGapColor) && (
              <div className="flex items-center gap-3 text-xs">
                {seg.topGapColor && (
                  <span className="flex items-center gap-1">
                    Top
                    <span
                      className="inline-block size-3 rounded-sm border border-border"
                      style={{ backgroundColor: seg.topGapColor }}
                    />
                  </span>
                )}
                {seg.bottomGapColor && (
                  <span className="flex items-center gap-1">
                    Btm
                    <span
                      className="inline-block size-3 rounded-sm border border-border"
                      style={{ backgroundColor: seg.bottomGapColor }}
                    />
                  </span>
                )}
              </div>
            )}
            {/* Segments produced by a manual split show an undo button.
                Clicking it merges all siblings in the same split group. */}
            {seg.splitGroup && (
              <button
                type="button"
                onClick={() => onMerge(seg.splitGroup as string)}
                className="flex items-center gap-1 text-amber-400 text-xs hover:underline"
              >
                <Undo2 className="size-3" />
                Undo split (merge group)
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
