// The ledger itself: a numbered margin, a rule, then the columns. Figures are
// set in mono; account flags are set as small capitals rather than badges.
// The heading above owns the caption and the actions; this component is the
// table and nothing else.
import { memo, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ldap } from "../../wailsjs/go/models";
import { formatValue, decodeUAC } from "../lib/format";
import { combineLastSeen, isStale, DEFAULT_STALE_DAYS } from "../lib/lastseen";
import { labelFor } from "@/lib/attrLabels";

export interface SortState { col: string; asc: boolean }

interface Props {
  entries: ldap.Entry[];
  loading?: boolean;
  columns: string[];
  sort: SortState | null;
  onSort: (col: string) => void;
  selectedDN: string | null;
  onSelectRow: (e: ldap.Entry) => void;
  checked: Set<string>;
  onToggleCheck: (dn: string) => void;
  onToggleAll: () => void;
  factsColumn: string | null;
  onInspectColumn: (col: string) => void;
}

export const ROW_H = 30;

const MONO_COLS = new Set(["distinguishedname", "objectsid", "objectguid", "samaccountname", "userprincipalname", "uid", "mail", "telephonenumber", "mobile", "employeenumber", "whencreated", "whenchanged", "pwdlastset", "lastlogontimestamp", "lastlogon", "accountexpires", "365 last sign-in"]);

function flagTone(flag: string): string {
  if (flag === "Disabled" || flag === "Locked out" || flag === "Password expired") return "crit";
  if (flag === "Password never expires" || flag === "Trusted for delegation") return "warn";
  return "";
}

/** Sort entries by a column's formatted value; stable and numeric-aware. */
export function sortEntries(entries: ldap.Entry[], sort: SortState | null): ldap.Entry[] {
  if (!sort) return entries;
  const copy = [...entries];
  copy.sort((a, b) => {
    const av = formatValue(sort.col, a.attributes?.[sort.col]) || "";
    const bv = formatValue(sort.col, b.attributes?.[sort.col]) || "";
    return sort.asc ? av.localeCompare(bv, undefined, { numeric: true }) : bv.localeCompare(av, undefined, { numeric: true });
  });
  return copy;
}

export function LedgerGrid({ entries, loading, columns, sort, onSort, selectedDN, onSelectRow, checked, onToggleCheck, onToggleAll, factsColumn, onInspectColumn }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirt = useVirtualizer({ count: entries.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 16 });
  const gridCols = useMemo(() => `28px 44px ${columns.map(() => "minmax(140px, 1fr)").join(" ")}`, [columns]);
  const allChecked = checked.size === entries.length && entries.length > 0;

  // Keep the selected row in view when selection moves by keyboard.
  useEffect(() => {
    if (!selectedDN) return;
    const i = entries.findIndex((e) => e.dn === selectedDN);
    if (i >= 0) rowVirt.scrollToIndex(i, { align: "auto" });
  }, [selectedDN]); // eslint-disable-line react-hooks/exhaustive-deps

  function onKey(ev: React.KeyboardEvent) {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    ev.preventDefault();
    const i = entries.findIndex((e) => e.dn === selectedDN);
    const next = ev.key === "ArrowDown" ? Math.min(entries.length - 1, i + 1) : Math.max(0, i - 1);
    if (entries[next]) onSelectRow(entries[next]);
  }

  return (
    <div ref={scrollRef} className={"ledger-grid" + (loading ? " is-loading" : "")} tabIndex={0} onKeyDown={onKey} aria-label="Results">
      <div className="ledger-grid-head" style={{ gridTemplateColumns: gridCols }}>
        <div className="ledger-cell is-check">
          <input type="checkbox" checked={allChecked} onChange={onToggleAll} aria-label="mark all" />
        </div>
        <div className="ledger-cell is-num">#</div>
        {columns.map((col) => {
          const on = sort?.col === col;
          return (
            <div key={col} className={"ledger-head-cell" + (factsColumn === col ? " is-facts" : "")}>
              <button className="ledger-head-sort" onClick={() => onSort(col)} title={`${col}. Click to sort.`}>
                <span className="truncate">{labelFor(col)}</span>
                {on && <span className="ledger-sort-mark">{sort!.asc ? "↑" : "↓"}</span>}
              </button>
              <button className="ledger-head-facts" onClick={() => onInspectColumn(col)} title="Column facts" aria-label={`facts for ${labelFor(col)}`}>?</button>
            </div>
          );
        })}
      </div>

      <div className="relative" style={{ height: rowVirt.getTotalSize() }}>
        {rowVirt.getVirtualItems().map((vi) => {
          const e = entries[vi.index];
          const isSel = selectedDN === e.dn;
          return (
            <div key={e.dn} onClick={() => onSelectRow(e)} className={"ledger-row" + (isSel ? " is-sel" : "") + (checked.has(e.dn) ? " is-marked" : "")}
              style={{ top: vi.start, height: ROW_H, gridTemplateColumns: gridCols }} role="row" aria-selected={isSel}>
              <div className="ledger-cell is-check" onClick={(ev) => ev.stopPropagation()}>
                <input type="checkbox" checked={checked.has(e.dn)} onChange={() => onToggleCheck(e.dn)} aria-label="mark row" />
              </div>
              <div className="ledger-cell is-num mono">{vi.index + 1}</div>
              {columns.map((col) => <Cell key={col} col={col} entry={e} facts={factsColumn === col} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const Cell = memo(function Cell({ col, entry, facts }: { col: string; entry: ldap.Entry; facts: boolean }) {
  const vals = entry.attributes?.[col];
  const lc = col.toLowerCase();
  const cls = "ledger-cell" + (facts ? " is-facts" : "");
  if (lc === "useraccountcontrol" && vals && vals.length) {
    const flags = decodeUAC(vals[0]);
    return (
      <div className={cls} title={vals[0]}>
        {flags.length === 0
          ? <span className="ledger-flag">enabled</span>
          : flags.map((f) => <span key={f} className={"ledger-flag " + flagTone(f)}>{f.toLowerCase()}</span>)}
      </div>
    );
  }
  if ((lc === "lastlogontimestamp" || lc === "lastlogon") && vals && vals.length) {
    const text = formatValue(col, vals);
    const stale = isStale(combineLastSeen(vals[0]));
    return (
      <div className={cls} title={text}>
        <span className={"truncate mono " + (text === "Never" ? "is-dim" : "")}>{text}</span>
        {stale && <span className="ledger-flag warn" title={`Not seen in more than ${DEFAULT_STALE_DAYS} days`}>stale</span>}
      </div>
    );
  }
  const text = formatValue(col, vals);
  return (
    <div className={cls}>
      <span className={"truncate selectable" + (MONO_COLS.has(lc) ? " mono" : "") + (text ? "" : " is-dim")} title={text}>{text || ""}</span>
    </div>
  );
});
