import { statusInfo, STATUS_TONE_CLASS, STATUS_DOT_CLASS, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

type Props = {
  status?: string | null;
  tone?: StatusTone;
  label?: string;
  className?: string;
  withDot?: boolean;
};

export function StatusBadge({ status, tone, label, className, withDot = true }: Props) {
  const info = tone ? { tone, label: label ?? "" } : statusInfo(status);
  const finalTone = tone ?? info.tone;
  const finalLabel = label ?? info.label;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium",
        STATUS_TONE_CLASS[finalTone],
        className,
      )}
    >
      {withDot && <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT_CLASS[finalTone])} />}
      {finalLabel}
    </span>
  );
}
