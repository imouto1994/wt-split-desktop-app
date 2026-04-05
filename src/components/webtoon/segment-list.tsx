/**
 * Simple ordered list showing each segment's absolute path, pixel height,
 * and gap color info (top/bottom hex colors from the removed strips).
 */
import type { SegmentMeta } from "./types";

interface SegmentListProps {
  segments: SegmentMeta[];
}

export default function SegmentList({ segments }: SegmentListProps) {
  if (!segments.length) return null;
  return (
    <ul className="list-disc pl-5 text-muted-foreground text-sm">
      {segments.map((seg) => (
        <li key={seg.path} className="flex flex-wrap items-center gap-x-2">
          <span>
            {seg.path} ({seg.height}px)
          </span>
          {(seg.topGapColor || seg.bottomGapColor) && (
            <span className="inline-flex items-center gap-2 text-xs">
              {seg.topGapColor && (
                <span className="flex items-center gap-0.5">
                  top
                  <span
                    className="inline-block size-2.5 rounded-sm border border-border"
                    style={{ backgroundColor: seg.topGapColor }}
                  />
                </span>
              )}
              {seg.bottomGapColor && (
                <span className="flex items-center gap-0.5">
                  btm
                  <span
                    className="inline-block size-2.5 rounded-sm border border-border"
                    style={{ backgroundColor: seg.bottomGapColor }}
                  />
                </span>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
