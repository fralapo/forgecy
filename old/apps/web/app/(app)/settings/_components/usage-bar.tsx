import { cn } from "@forgecy/ui";

/** Budget or disk usage bar; the text next to it carries the numbers, never the colour alone. */
export function UsageBar({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const tone = percent >= 100 ? "bg-error" : percent >= 70 ? "bg-warning" : "bg-success";
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className="h-2 w-full overflow-hidden rounded-full bg-app"
    >
      <div className={cn("h-full", tone)} style={{ width: `${clamped}%` }} />
    </div>
  );
}
