import { Plus, X } from "lucide-react";
import { Condition, MatchOp, OPERATORS, OperatorKey, newCondition } from "../lib/filterBuilder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
            <Input className="font-mono h-7 flex-1" list="adq-attr-list" placeholder="field (e.g. Department)"
              value={c.attribute} onChange={(e) => update(c.id, { attribute: e.target.value })} />
            <Select value={c.operator} onValueChange={(val) => update(c.id, { operator: val as OperatorKey })}>
              <SelectTrigger className="h-7 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {OPERATORS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input className="font-mono h-7 flex-1" placeholder={needsValue ? "value" : "—"}
              value={c.value} disabled={!needsValue} onChange={(e) => update(c.id, { value: e.target.value })} />
            <Button variant="ghost" size="icon" onClick={() => remove(c.id)} aria-label="remove condition"><X size={14} /></Button>
          </div>
        );
      })}

      <Button variant="ghost" size="sm" className="px-2" onClick={add}><Plus size={13} /> Add condition</Button>

      {/* Common fields first (with plain-language labels), then the full set. */}
      <datalist id="adq-attr-list">
        {COMMON_COLUMNS.filter((a) => attributes.some((x) => x.toLowerCase() === a.toLowerCase())).map((a) => <option key={"c-" + a} value={a} label={labelFor(a)} />)}
        {attributes.map((a) => <option key={a} value={a} label={labelFor(a)} />)}
      </datalist>
    </div>
  );
}
