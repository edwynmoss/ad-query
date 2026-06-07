import { useMemo, useState } from "react";
import { Plus, X, ChevronDown } from "lucide-react";
import { Condition, MatchOp, OPERATORS, OperatorKey, newCondition } from "../lib/filterBuilder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { labelFor, COMMON_COLUMNS } from "../lib/attrLabels";

interface Props {
  conditions: Condition[];
  matchOp: MatchOp;
  onChange: (conditions: Condition[], matchOp: MatchOp) => void;
  attributes: string[];
}

export function FilterBuilder({ conditions, matchOp, onChange, attributes }: Props) {
  function update(id: string, patch: Partial<Condition>) {
    onChange(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)), matchOp);
  }
  function add() { onChange([...conditions, newCondition()], matchOp); }
  function remove(id: string) { onChange(conditions.filter((c) => c.id !== id), matchOp); }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[11.5px] text-ink-2">
        <span>Match</span>
        <ToggleGroup type="single" variant="outline" value={matchOp} onValueChange={(val) => val && onChange(conditions, val as MatchOp)}>
          <ToggleGroupItem value="and">All</ToggleGroupItem>
          <ToggleGroupItem value="or">Any</ToggleGroupItem>
        </ToggleGroup>
        <span>of the following</span>
      </div>

      {conditions.length === 0 && (
        <div className="text-[12px] text-ink-3">No conditions — all objects of the selected type.</div>
      )}

      {conditions.map((c) => {
        const needsValue = OPERATORS.find((o) => o.key === c.operator)?.needsValue ?? true;
        return (
          <div key={c.id} className="flex items-center gap-1.5">
            <FieldCombobox value={c.attribute} attributes={attributes} onChange={(v) => update(c.id, { attribute: v })} />
            <Select value={c.operator} onValueChange={(val) => update(c.id, { operator: val as OperatorKey })}>
              <SelectTrigger size="sm" className="w-32 shrink-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                {OPERATORS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input className="font-mono h-8 flex-1 min-w-0" placeholder={needsValue ? "value" : "—"}
              value={c.value} disabled={!needsValue} onChange={(e) => update(c.id, { value: e.target.value })} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => remove(c.id)} aria-label="remove condition"><X size={14} /></Button>
          </div>
        );
      })}

      <Button variant="ghost" size="sm" className="px-2" onClick={add}><Plus size={13} /> Add condition</Button>
    </div>
  );
}

// Searchable field dropdown — styled to match the operator <Select> so the row
// reads as two uniform dropdowns. Searches friendly labels + raw names, common
// fields first, and allows a custom attribute via "Use …".
function FieldCombobox({ value, attributes, onChange }: { value: string; attributes: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    const ranked = [...COMMON_COLUMNS.filter((a) => attributes.some((x) => x.toLowerCase() === a.toLowerCase())), ...attributes];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const a of ranked) {
      const lc = a.toLowerCase();
      if (seen.has(lc)) continue;
      seen.add(lc);
      if (!query || lc.includes(query) || labelFor(a).toLowerCase().includes(query)) out.push(a);
      if (out.length >= 50) break;
    }
    return out;
  }, [q, attributes]);

  const exact = !!q.trim() && attributes.some((a) => a.toLowerCase() === q.trim().toLowerCase());
  function pick(a: string) { onChange(a); setOpen(false); setQ(""); }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button type="button"
          className="flex h-8 flex-1 min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-[12px] shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30">
          <span className={"truncate " + (value ? "" : "text-muted-foreground")}>{value ? labelFor(value) : "Field…"}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] p-0">
        <div className="p-2 border-b border-line">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fields…" className="h-8" />
        </div>
        <div className="max-h-56 overflow-auto py-1">
          {matches.map((a) => (
            <button key={a} type="button" onClick={() => pick(a)}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-sunken">
              <span className="truncate">{labelFor(a)}</span>
              <span className="shrink-0 text-[10.5px] text-ink-3 font-mono">{a}</span>
            </button>
          ))}
          {q.trim() && !exact && (
            <button type="button" onClick={() => pick(q.trim())}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-brand hover:bg-sunken">
              Use “{q.trim()}”
            </button>
          )}
          {matches.length === 0 && !q.trim() && <div className="px-3 py-2 text-[12px] text-ink-3">No fields.</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
