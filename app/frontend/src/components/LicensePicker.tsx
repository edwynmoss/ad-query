import { cn } from "@/lib/utils";
import type { m365 } from "../../wailsjs/go/models";

// Detected-license selector. `selected` is a list of product names; an empty
// list means "All licenses". Shared by the on-grid 365 check and the Licenses
// report so selection behaves identically everywhere.
export function LicensePicker({
  skus,
  selected,
  onChange,
}: {
  skus: m365.LicenseSku[];
  selected: string[];
  onChange: (s: string[]) => void;
}) {
  const all = selected.length === 0;
  function toggle(product: string) {
    onChange(selected.includes(product) ? selected.filter((x) => x !== product) : [...selected, product]);
  }
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <Chip active={all} onClick={() => onChange([])}>All licenses</Chip>
      {skus.map((s) => (
        <Chip key={s.product} active={!all && selected.includes(s.product)} onClick={() => toggle(s.product)}>
          {s.product}
          <span className={cn("ml-1.5", !all && selected.includes(s.product) ? "opacity-70" : "text-ink-3")}>{s.assigned}</span>
        </Chip>
      ))}
      {skus.length === 0 && <span className="text-[12px] text-ink-3">No subscriptions detected in this tenant.</span>}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center h-[26px] px-2.5 rounded-md border text-[11.5px] transition-colors cursor-pointer",
        active ? "border-brand bg-brand-soft text-brand" : "border-border bg-card text-ink-2 hover:bg-sunken",
      )}
    >
      {children}
    </button>
  );
}
