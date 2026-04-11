/**
 * Multi-line split editor modal.
 *
 * Displays a full-width preview of a segment image with draggable horizontal
 * split lines. The user can add/remove lines to split the segment into N+1
 * sub-segments, then save to apply the split on disk.
 *
 * Coordinate system:
 *   - "display space": pixel positions within the rendered <img> inside the
 *     scrollable canvas. This is what the user sees and drags.
 *   - "image space": actual pixel positions in the source image file.
 *   - Conversion: imagePx = displayY * (naturalHeight / displayHeight)
 *
 * Each line has:
 *   - An invisible 24px-tall hit area (z-20) for easy mouse targeting
 *   - A visible 2px colored line (z-10, pointer-events-none)
 *   - A handle badge showing the approximate pixel position and a remove button
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type SegmentMeta, toLocalFileUrl } from "./types";

interface SplitEditorModalProps {
  segment: SegmentMeta | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (filePath: string, breakpointsPx: number[]) => void;
}

// Each split line gets a distinct color so they're visually distinguishable.
// Colors cycle if more than 6 lines are added.
const LINE_COLORS = [
  "bg-emerald-400",
  "bg-sky-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-violet-400",
  "bg-orange-400",
];

const HANDLE_COLORS = [
  "bg-emerald-400",
  "bg-sky-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-violet-400",
  "bg-orange-400",
];

function getLineColor(index: number): string {
  return LINE_COLORS[index % LINE_COLORS.length];
}

function getHandleColor(index: number): string {
  return HANDLE_COLORS[index % HANDLE_COLORS.length];
}

export default function SplitEditorModal({
  segment,
  isOpen,
  onClose,
  onSave,
}: SplitEditorModalProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // lines[] stores each split line's Y position in display space.
  // The array is unordered — lines are sorted visually at render time.
  const [lines, setLines] = useState<number[]>([]);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const [displayHeight, setDisplayHeight] = useState(0);
  // Tracks which line index is currently being dragged (null = not dragging).
  const draggingRef = useRef<number | null>(null);

  /** Converts a display-space Y coordinate to image-space pixels. */
  const toPixels = useCallback(
    (displayY: number) => {
      if (!displayHeight || !naturalHeight) return 0;
      return Math.round((displayY / displayHeight) * naturalHeight);
    },
    [displayHeight, naturalHeight],
  );

  /** Clamps a Y position to stay within the canvas bounds (8px margin). */
  const clampY = useCallback(
    (y: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return y;
      const maxY = Math.max(8, canvas.scrollHeight - 8);
      return Math.min(Math.max(8, y), maxY);
    },
    [],
  );

  /**
   * When the preview image loads, capture the display/natural height ratio
   * and place the initial split line at 50% of the image height.
   */
  const handleImageLoad = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const scrollH = canvas.scrollHeight || img.getBoundingClientRect().height;
    const natH = img.naturalHeight || 0;

    setDisplayHeight(scrollH);
    setNaturalHeight(natH);

    setLines([Math.round(scrollH * 0.5)]);
  }, []);

  // Global mouse listeners for drag behavior.
  // mouseup anywhere stops dragging; mousemove updates the active line.
  useEffect(() => {
    const handleMouseUp = () => {
      draggingRef.current = null;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const idx = draggingRef.current;
      if (idx === null) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Convert viewport Y to canvas-relative Y, accounting for scroll offset.
      const rect = canvas.getBoundingClientRect();
      const y = clampY(e.clientY - rect.top + canvas.scrollTop);
      setLines((prev) => {
        const next = [...prev];
        next[idx] = y;
        return next;
      });
    };

    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [clampY]);

  const startDrag = useCallback((index: number, e: React.MouseEvent) => {
    draggingRef.current = index;
    e.preventDefault();
  }, []);

  /**
   * Adds a new split line in the largest gap between existing lines.
   * This distributes new lines evenly rather than stacking them in one spot.
   */
  const addLine = useCallback(() => {
    setLines((prev) => {
      const sorted = [...prev].sort((a, b) => a - b);
      const canvas = canvasRef.current;
      const maxH = canvas ? canvas.scrollHeight : displayHeight || 1;

      // edges = [top_of_image, line1, line2, ..., bottom_of_image]
      const edges = [0, ...sorted, maxH];
      let bestGap = 0;
      let bestMid = maxH / 2;
      for (let i = 0; i < edges.length - 1; i++) {
        const gap = edges[i + 1] - edges[i];
        if (gap > bestGap) {
          bestGap = gap;
          bestMid = edges[i] + gap / 2;
        }
      }
      return [...prev, clampY(Math.round(bestMid))];
    });
  }, [displayHeight, clampY]);

  /** Removes a line by index. At least 1 line must always remain. */
  const removeLine = useCallback((index: number) => {
    setLines((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  /**
   * Converts all display-space line positions to image-space pixel breakpoints
   * and invokes onSave. Breakpoints outside valid bounds are filtered out.
   */
  const handleSave = useCallback(() => {
    if (!segment || !displayHeight || !naturalHeight) return;
    const breakpoints = lines.map(toPixels).filter((px) => px > 0 && px < naturalHeight);
    if (!breakpoints.length) return;
    onSave(segment.path, breakpoints);
  }, [segment, displayHeight, naturalHeight, lines, toPixels, onSave]);

  if (!isOpen || !segment) return null;

  // Sort lines by Y position for visual rendering, but keep original indices
  // so drag/remove operations target the correct line in state.
  const sortedWithIndex = lines
    .map((y, i) => ({ y, i }))
    .sort((a, b) => a.y - b.y);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
      <div className="flex max-h-[90vh] w-[90%] max-w-[900px] flex-col gap-3 rounded-xl border border-border bg-card p-4">
        {/* Header: segment info + add line button */}
        <div className="flex items-center justify-between">
          <div className="text-muted-foreground text-sm">
            {segment.path} &bull; {segment.height}px
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {lines.length} split{lines.length > 1 ? "s" : ""} &rarr;{" "}
              {lines.length + 1} parts
            </span>
            <Button variant="outline" size="xs" onClick={addLine}>
              <Plus data-icon="inline-start" className="size-3" />
              Add
            </Button>
          </div>
        </div>

        {/* Scrollable image canvas with split lines overlaid */}
        <div
          ref={canvasRef}
          className="relative max-h-[70vh] overflow-auto rounded-lg border border-border bg-background"
        >
          <img
            ref={imageRef}
            src={toLocalFileUrl(segment.path, segment.cacheKey)}
            alt="Segment preview"
            className="block h-auto w-full"
            onLoad={handleImageLoad}
          />

          {sortedWithIndex.map(({ y, i }, sortIdx) => (
            <div key={`line-${i}`}>
              {/* Invisible 24px-tall hit area centered on the line for easy grabbing */}
              <div
                className="absolute right-0 left-0 z-20 cursor-row-resize"
                style={{ top: `${y - 12}px`, height: "24px" }}
                onMouseDown={(e) => startDrag(i, e)}
              />

              {/* Visible 2px colored line (pointer-events-none so the hit area handles clicks) */}
              <div
                className={`pointer-events-none absolute right-0 left-0 z-10 h-[2px] ${getLineColor(sortIdx)}`}
                style={{ top: `${y}px` }}
              >
                {/* Handle badge: shows pixel position + remove button */}
                <div
                  className={`pointer-events-auto absolute right-2 -translate-y-1/2 flex cursor-grab items-center gap-1 select-none rounded-md ${getHandleColor(sortIdx)} px-2 py-1 font-mono text-xs text-zinc-900 shadow-md`}
                >
                  {toPixels(y)}px
                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="ml-1 flex items-center justify-center rounded-full hover:bg-black/10"
                      onClick={() => removeLine(i)}
                    >
                      <Minus className="size-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button variant="outline" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" size="lg" onClick={handleSave}>
            Save Split ({lines.length + 1} parts)
          </Button>
        </div>
      </div>
    </div>
  );
}
