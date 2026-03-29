/**
 * Reusable folder picker control: a button that triggers a native OS
 * directory dialog, plus a monospace path display showing the selection.
 */
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FolderPickerProps {
  label: string;
  selectedPath: string;
  onPick: () => void;
}

export default function FolderPicker({
  label,
  selectedPath,
  onPick,
}: FolderPickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button variant="default" size="lg" onClick={onPick}>
        <FolderOpen data-icon="inline-start" />
        {label}
      </Button>
      {selectedPath && (
        <span className="font-mono text-emerald-400 text-sm">
          {selectedPath}
        </span>
      )}
    </div>
  );
}
