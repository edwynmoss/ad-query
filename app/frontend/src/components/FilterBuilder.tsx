import { Plus, X } from "lucide-react";
import { Condition, MatchOp, OPERATORS, OperatorKey, newCondition } from "../lib/filterBuilder";

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
      <div className="flex items-center gap-2 text-[11.5px]" style={{ color: "var(--color-ink-2)" }}>
        <span>Match</span>
        <div className="seg">
          <button data-active={matchOp === "and"} onClick={() => onChange(conditions, "and")}>All</button>
          <button data-active={matchOp === "or"} onClick={() => onChange(conditions, "or")}>Any</button>
        </div>
        <span>of the following</span>
      </div>

      {conditions.length === 0 && (
        <div className="text-[12px]" style={{ color: "var(--color-ink-3)" }}>No conditions — all objects of the selected type.</div>
      )}

      {conditions.map((c) => {
        const needsValue = OPERATORS.find((o) => o.key === c.operator)?.needsValue ?? true;
        return (
          <div key={c.id} className="flex items-center gap-1.5">
            <input className="input mono h-7 flex-1" list="adq-attr-list" placeholder="attribute"
              value={c.attribute} onChange={(e) => update(c.id, { attribute: e.target.value })} />
            <select className="input h-7 w-36" value={c.operator} onChange={(e) => update(c.id, { operator: e.target.value as OperatorKey })}>
              {OPERATORS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <input className="input mono h-7 flex-1" placeholder={needsValue ? "value" : "—"}
              value={c.value} disabled={!needsValue} onChange={(e) => update(c.id, { value: e.target.value })} />
            <button className="btn btn-quiet btn-icon" onClick={() => remove(c.id)} aria-label="remove condition"><X size={14} /></button>
          </div>
        );
      })}

      <button className="btn btn-quiet h-7 px-2" onClick={add}><Plus size={13} /> Add condition</button>

      <datalist id="adq-attr-list">{attributes.map((a) => <option key={a} value={a} />)}</datalist>
    </div>
  );
}
