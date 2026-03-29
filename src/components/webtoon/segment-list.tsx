/** Simple ordered list showing each segment's absolute path and pixel height. */
import type { SegmentMeta } from "./types";

interface SegmentListProps {
  segments: SegmentMeta[];
}

export default function SegmentList({ segments }: SegmentListProps) {
  if (!segments.length) return null;
  return (
    <ul className="list-disc pl-5 text-muted-foreground text-sm">
      {segments.map((seg) => (
        <li key={seg.path}>
          {seg.path} ({seg.height}px)
        </li>
      ))}
    </ul>
  );
}
