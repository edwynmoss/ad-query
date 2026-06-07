import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/friendlyError";

// Inline, severity-styled error banner: plain-language title + remedy, with the
// raw text tucked into an expandable "Details" for support. Used app-wide so
// failures read the same everywhere (connection, sign-in, queries, reports).
export function ErrorBanner({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const { title, remedy, raw } = friendlyError(error);
  const showDetails = raw && raw !== title;
  return (
    <div role="alert" className={cn("rounded-lg bg-critical-soft px-3.5 py-2.5 text-[12px]", className)}>
      <div className="flex gap-2.5">
        <AlertCircle size={15} className="shrink-0 mt-0.5 text-critical" />
        <div className="min-w-0">
          <div className="font-medium text-critical">{title}</div>
          {remedy && <div className="mt-0.5 text-ink-2">{remedy}</div>}
          {showDetails && (
            <details className="mt-1.5">
              <summary className="cursor-pointer select-none text-[11px] text-ink-3 hover:text-ink-2">Details</summary>
              <code className="mt-1 block whitespace-pre-wrap break-words selectable text-[11px] text-ink-2 font-mono">{raw}</code>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
