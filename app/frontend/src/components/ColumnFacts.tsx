// Column facts: what is in one column of the current result set, typeset as
// an index rather than a chart. Values are ranked by count; clicking one adds
// an "is" condition (Alt-click adds "is not").
import { useMemo } from "react";
import type { ldap } from "../../wailsjs/go/models";
import { formatValue } from "../lib/format";
import { labelFor } from "../lib/attrLabels";

interface Props {
  column: string;
  columns: string[];
  entries: ldap.Entry[];
  onPickColumn: (col: string) => void;
  onFilterValue: (column: string, value: string, exclude: boolean) => void;
  onSort: (column: string) => void;
  onHide: (column: string) => void;
  onCopy: (text: string) => void;
}

const TOP = 12;

export function ColumnFacts({ column, columns, entries, onPickColumn, onFilterValue, onSort, onHide, onCopy }: Props) {
  const facts = useMemo(() => {
    const counts = new Map<string, number>();
    let empty = 0;
    let numeric = 0;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const e of entries) {
      const raw = e.attributes?.[column];
      const text = raw && raw.length ? formatValue(column, raw) : "";
      if (!text) { empty++; continue; }
      counts.set(text, (counts.get(text) ?? 0) + 1);
      const n = Number(text.replace(/[,\s]/g, ""));
      if (text.trim() !== "" && Number.isFinite(n)) { numeric++; min = Math.min(min, n); max = Math.max(max, n); sum += n; }
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const nonEmpty = entries.length - empty;
    const unique = nonEmpty > 0 && counts.size === nonEmpty;
    return { rows: entries.length, empty, distinct: counts.size, ranked: ranked.slice(0, TOP), moreThanTop: ranked.length > TOP, unique, numeric: numeric >= Math.max(1, nonEmpty * 0.8) ? { min, max, mean: sum / numeric } : null, nonEmpty };
  }, [entries, column]);

  const pct = (n: number, whole: number) => (whole <= 0 ? "" : `${Math.round((n / whole) * 100)}%`);

  return (
    <div className="ledger-facts">
      <div className="ledger-eyebrow">Column</div>
      <select className="ledger-facts-title" value={column} onChange={(e) => onPickColumn(e.target.value)} aria-label="Column to inspect">
        {columns.map((c) => <option key={c} value={c}>{labelFor(c)}</option>)}
      </select>
      <div className="ledger-facts-sub">{facts.rows.toLocaleString()} rows in view · <span className="mono">{column}</span></div>

      <dl className="ledger-facts-dl">
        <dt>Rows in view</dt><dd className="mono">{facts.rows.toLocaleString()}</dd>
        <dt>Empty</dt><dd className="mono">{facts.empty.toLocaleString()}</dd>
        <dt>Distinct values</dt><dd className="mono">{facts.distinct.toLocaleString()}{facts.unique ? " (all unique)" : ""}</dd>
        {facts.numeric && (<>
          <dt>Smallest</dt><dd className="mono">{fmt(facts.numeric.min)}</dd>
          <dt>Largest</dt><dd className="mono">{fmt(facts.numeric.max)}</dd>
          <dt>Average</dt><dd className="mono">{fmt(facts.numeric.mean)}</dd>
        </>)}
      </dl>

      {!facts.unique && facts.ranked.length > 0 && (
        <>
          <div className="ledger-h4">Values, most common first</div>
          <div className="ledger-leaders">
            {facts.ranked.map(([value, count]) => (
              <button key={value} className="ledger-leader" title={`Keep only ${value}. Alt-click to exclude.`} onClick={(e) => onFilterValue(column, value, e.altKey)}>
                <span className="ledger-leader-label">{value}</span>
                <i />
                <b className="mono">{count.toLocaleString()}</b>
                <small className="mono">{pct(count, facts.nonEmpty)}</small>
              </button>
            ))}
            {facts.empty > 0 && (
              <button className="ledger-leader is-muted" title="Keep only rows where this is empty" onClick={() => onFilterValue(column, "", false)}>
                <span className="ledger-leader-label">empty</span>
                <i />
                <b className="mono">{facts.empty.toLocaleString()}</b>
                <small className="mono">{pct(facts.empty, facts.rows)}</small>
              </button>
            )}
          </div>
          <p className="ledger-note">Click a value to keep only those rows. Hold Alt to exclude it instead.{facts.moreThanTop ? ` Showing the top ${TOP} of ${facts.distinct.toLocaleString()}.` : ""}</p>
        </>
      )}
      {facts.unique && <p className="ledger-note">Every value is different, so there is nothing to rank.</p>}
      {facts.ranked.length === 0 && !facts.unique && <p className="ledger-note">No values in view.</p>}

      <div className="ledger-facts-acts">
        <button className="ledger-link" onClick={() => onSort(column)}>Sort by this column</button>
        <button className="ledger-link" onClick={() => onHide(column)}>Hide column</button>
        <button className="ledger-link" onClick={() => onCopy(facts.ranked.map(([v, c]) => `${v}\t${c}`).join("\n"))}>Copy values</button>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "";
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
