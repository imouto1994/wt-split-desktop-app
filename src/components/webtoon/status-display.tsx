/**
 * Colored status text that reflects the current operation state.
 * Modes map to Tailwind color classes: info/ok = green, warn = amber, error = rose.
 */
type StatusMode = "info" | "ok" | "warn" | "error";

interface StatusDisplayProps {
  message: string;
  mode: StatusMode;
}

const modeClasses: Record<StatusMode, string> = {
  info: "text-emerald-400",
  ok: "text-emerald-400",
  warn: "text-amber-400",
  error: "text-rose-400",
};

export default function StatusDisplay({ message, mode }: StatusDisplayProps) {
  if (!message) return null;
  return (
    <span className={`font-mono text-sm ${modeClasses[mode]}`}>{message}</span>
  );
}
