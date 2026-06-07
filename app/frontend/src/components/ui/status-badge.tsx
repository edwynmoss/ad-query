import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Semantic status pill shared across the app (account flags, ACL allow/deny,
// stale markers, reclaim tallies). Tones map to the semantic palette utilities
// so there is no per-call inline styling.
export type StatusTone = "neutral" | "success" | "warning" | "critical";

const TONE: Record<Exclude<StatusTone, "neutral">, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  critical: "bg-critical-soft text-critical",
};

export function StatusBadge({
  tone = "neutral",
  title,
  className,
  children,
}: {
  tone?: StatusTone;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  if (tone === "neutral")
    return <Badge variant="secondary" title={title} className={className}>{children}</Badge>;
  return (
    <Badge variant="outline" title={title} className={cn("border-transparent", TONE[tone], className)}>
      {children}
    </Badge>
  );
}
