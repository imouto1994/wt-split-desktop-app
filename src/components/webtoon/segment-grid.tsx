/**
 * Responsive grid of segment thumbnail cards with staged editing controls.
 *
 * Each card shows:
 *   - Lazy-loaded image thumbnail via the local-file:// custom protocol
 *   - Index number and pixel height
 *   - "Open" button to reveal the file in the OS file manager
 *   - "Edit" button to open the multi-line split editor (available on all
 *     segments — amber for recommended splits, outline for optional)
 *   - "Hide" / "Unhide" button to toggle segment visibility for staged editing
 *   - "Undo split" button (if the segment belongs to a split group) to restore
 *     the original segment by deleting children (staged — no re-stitching)
 *
 * Hidden segments are rendered with reduced opacity so the user can see what
 * they've excluded. Edit and Open are disabled on hidden segments, but Undo
 * Split stays active so the user can always reverse a split even if all
 * children are hidden.
 */
import { Eye, EyeOff, Undo2 } from "lucide-react";
import { showInFolder } from "@/actions/webtoon";
import { Button } from "@/components/ui/button";
import { type SegmentMeta, toLocalFileUrl } from "./types";

// Segments with height/width ratio above this are flagged as "recommended
// to split." The Edit button is shown on ALL segments, but segments above
// this threshold get a prominent amber Edit button to signal urgency, while
// segments below it get a subtle outline Edit button for optional splitting.
const EDIT_ASPECT_RATIO_THRESHOLD = 3;

interface SegmentGridProps {
  segments: SegmentMeta[];
  /** Set of segment file paths currently hidden by the user. */
  hiddenPaths: Set<string>;
  onEdit: (segment: SegmentMeta) => void;
  onHide: (segment: SegmentMeta) => void;
  onUnhide: (segment: SegmentMeta) => void;
  /** Undo a staged split — deletes children and restores the original. */
  onUndoSplit: (groupId: string) => void;
  /** When true, all action buttons are disabled (e.g. during Confirm/Discard/Process). */
  isDisabled: boolean;
}

/** True when the segment is tall enough that splitting is recommended. */
function shouldSplit(seg: SegmentMeta): boolean {
  return seg.width > 0 && seg.height / seg.width > EDIT_ASPECT_RATIO_THRESHOLD;
}

export default function SegmentGrid({
  segments,
  hiddenPaths,
  onEdit,
  onHide,
  onUnhide,
  onUndoSplit,
  isDisabled,
}: SegmentGridProps) {
  if (!segments.length) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {segments.map((seg, idx) => {
        const isHidden = hiddenPaths.has(seg.path);
        return (
          <div
            key={seg.path}
            className={`overflow-hidden rounded-lg border border-border bg-background ${isHidden ? "opacity-40" : ""}`}
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
                  {/* Hide / Unhide toggle */}
                  {isHidden ? (
                    <button
                      type="button"
                      disabled={isDisabled}
                      onClick={() => onUnhide(seg)}
                      className="font-semibold text-blue-400 no-underline hover:underline disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Eye className="inline size-3.5" /> Unhide
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isDisabled}
                      onClick={() => onHide(seg)}
                      className="font-semibold text-rose-400 no-underline hover:underline disabled:pointer-events-none disabled:opacity-50"
                    >
                      <EyeOff className="inline size-3.5" /> Hide
                    </button>
                  )}
                  {/* Reveals the file in Finder/Explorer instead of navigating the window */}
                  {!isHidden && (
                    <button
                      type="button"
                      disabled={isDisabled}
                      onClick={() => showInFolder(seg.path)}
                      className="font-semibold text-emerald-400 no-underline hover:underline disabled:pointer-events-none disabled:opacity-50"
                    >
                      Open
                    </button>
                  )}
                  {/* Edit is available on all segments. Amber = recommended
                      split (tall segment), outline = optional split. */}
                  {!isHidden && (
                    <Button
                      variant={shouldSplit(seg) ? "default" : "outline"}
                      size="xs"
                      disabled={isDisabled}
                      onClick={() => onEdit(seg)}
                      className={shouldSplit(seg) ? "bg-amber-600 text-white hover:bg-amber-700" : ""}
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
              {/* Undo split stays active even on hidden segments so the user
                  can always reverse a split (auto-unhides all group members). */}
              {seg.splitGroup && (
                <button
                  type="button"
                  disabled={isDisabled}
                  onClick={() => onUndoSplit(seg.splitGroup as string)}
                  className="flex items-center gap-1 text-amber-400 text-xs hover:underline disabled:pointer-events-none disabled:opacity-50"
                >
                  <Undo2 className="size-3" />
                  Undo split (restore original)
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
