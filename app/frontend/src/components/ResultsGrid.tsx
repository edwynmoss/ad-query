import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Download, ArrowUp, ArrowDown } from "lucide-react";
import type { ldap } from "../../wailsjs/go/models";
import { formatValue, decodeUAC } from "../lib/format";
import { combineLastSeen, isStale, DEFAULT_STALE_DAYS } from "../lib/lastseen";
import { ExportDialog } from "./ExportDialog";

interface Props {
  result: ldap.SearchResult | null;
  columns: string[];
  selectedDN: string | null;
  onSelectRow: (e: ldap.Entry) => void;
}

const ROW_H = 33;

function uacStatusClass(flag: string): string {
  if (flag === "Disabled" || flag === "Locked out" || flag === "Password expired") return "status-danger";
  if (flag === "Password never expires" || flag === "Trusted for delegation") return "status-warn";
  return "status-neutral";
}

export function ResultsGrid({ result, columns, selectedDN, onSelectRow }: Props) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showExport, setShowExport] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const entries = result?.entries ?? [];

  const sorted = useMemo(() => {
    if (!sortCol) return entries;
    const copy = [...entries];
    copy.sort((a, b) => {
      const av = formatValue(sortCol, a.attributes?.[sortCol]) || "";
      const bv = formatValue(sortCol, b.attributes?.[sortCol]) || "";
      return sortAsc ? av.localeCompare(bv, undefined, { numeric: true }) : bv.localeCompare(av, undefined, { numeric: true });
    });
    return copy;
  }, [entries, sortCol, sortAsc]);

  const rowVirt = useVirtualizer({ count: sorted.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 14 });
  const gridCols = useMemo(() => `30px 52px ${columns.map(() => "minmax(150px, 1fr)").join(" ")}`, [columns]);

  function toggleSort(col: string) { if (sortCol === col) setSortAsc((s) => !s); else { setSortCol(col); setSortAsc(true); } }
  function toggleCheck(dn: string) { setChecked((s) => { const n = new Set(s); n.has(dn) ? n.delete(dn) : n.add(dn); return n; }); }
  function toggleAll() { setChecked((s) => (s.size === entries.length ? new Set() : new Set(entries.map((e) => e.dn)))); }

  if (!result) {
    return (
      <div className="flex-1 grid place-items-center" style={{ background: "var(--color-paper)" }}>
        <div className="text-center">
          <div className="display text-[19px]" style={{ color: "var(--color-ink-2)" }}>No record set</div>
          <p className="text-[12.5px] mt-1" style={{ color: "var(--color-ink-3)" }}>Compose a query and run it to draw results into the ledger.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ background: "var(--color-paper)" }}>
      {/* Ledger caption / toolbar */}
      <div className="flex items-center justify-between px-4 h-10 shrink-0" style={{ borderTop: "1px solid var(--color-line)", borderBottom: "1px solid var(--color-line)" }}>
        <div className="flex items-baseline gap-2">
          <span className="display text-[15px]">Results</span>
          <span className="text-[12px]" style={{ color: "var(--color-ink-3)" }}>
            {result.count.toLocaleString()} records{checked.size > 0 ? ` · ${checked.size} marked` : ""}{result.truncated ? " · truncated" : ""}
          </span>
        </div>
        <button className="btn h-8" onClick={() => setShowExport(true)} disabled={entries.length === 0}>
          <Download size={13} /> Export CSV{checked.size > 0 ? ` (${checked.size})` : ""}
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto">
        {/* Header */}
        <div className="sticky top-0 z-10" style={{ display: "grid", gridTemplateColumns: gridCols, background: "var(--color-paper)", borderBottom: "2px solid var(--color-line-strong)" }}>
          <div className="flex items-center justify-center"><input type="checkbox" checked={checked.size === entries.length && entries.length > 0} onChange={toggleAll} aria-label="mark all" /></div>
          <div className="flex items-center justify-end pr-2 eyebrow" style={{ paddingTop: 0 }}>#</div>
          {columns.map((col) => (
            <button key={col} onClick={() => toggleSort(col)} className="flex items-center gap-1 h-9 px-3 text-left eyebrow hover:text-[var(--color-ink)]" title={`Sort by ${col}`}>
              <span className="truncate">{col}</span>
              {sortCol === col && (sortAsc ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
            </button>
          ))}
        </div>

        {/* Virtualized ledger body */}
        <div style={{ height: rowVirt.getTotalSize(), position: "relative" }}>
          {rowVirt.getVirtualItems().map((vi) => {
            const e = sorted[vi.index];
            const isSel = selectedDN === e.dn;
            return (
              <div key={e.dn} onClick={() => onSelectRow(e)} className="absolute left-0 w-full cursor-pointer group"
                style={{
                  top: vi.start, height: ROW_H, display: "grid", gridTemplateColumns: gridCols,
                  background: isSel ? "var(--color-accent-weak)" : "transparent",
                  borderBottom: "1px solid var(--color-line)",
                  boxShadow: isSel ? "inset 2px 0 0 var(--color-accent)" : "inset 2px 0 0 transparent",
                }}
                onMouseEnter={(ev) => { if (!isSel) (ev.currentTarget as HTMLElement).style.background = "var(--color-sunken)"; }}
                onMouseLeave={(ev) => { if (!isSel) (ev.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div className="flex items-center justify-center" onClick={(ev) => ev.stopPropagation()}>
                  <input type="checkbox" checked={checked.has(e.dn)} onChange={() => toggleCheck(e.dn)} aria-label="mark row" />
                </div>
                <div className="flex items-center justify-end pr-2 text-[11px] tabular-nums" style={{ color: "var(--color-ink-3)", fontFamily: "var(--font-mono)" }}>{vi.index + 1}</div>
                {columns.map((col) => <Cell key={col} col={col} entry={e} />)}
              </div>
            );
          })}
          {entries.length === 0 && <div className="px-4 py-12 text-center text-[13px]" style={{ color: "var(--color-ink-3)" }}>No entries matched this query.</div>}
        </div>
      </div>

      {showExport && (
        <ExportDialog allEntries={entries} selectedEntries={entries.filter((e) => checked.has(e.dn))} columns={columns} onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}

function Cell({ col, entry }: { col: string; entry: ldap.Entry }) {
  const vals = entry.attributes?.[col];
  if (col.toLowerCase() === "useraccountcontrol" && vals && vals.length) {
    const flags = decodeUAC(vals[0]);
    return (
      <div className="flex items-center gap-1.5 px-3 overflow-hidden" title={vals[0]}>
        {flags.length === 0
          ? <span className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>Enabled</span>
          : flags.map((f) => <span key={f} className={"status " + uacStatusClass(f)}>{f}</span>)}
      </div>
    );
  }
  const lc = col.toLowerCase();
  if ((lc === "lastlogontimestamp" || lc === "lastlogon") && vals && vals.length) {
    const text = formatValue(col, vals); // date or "Never"
    const stale = isStale(combineLastSeen(vals[0]));
    return (
      <div className="flex items-center gap-1.5 px-3 overflow-hidden" title={text}>
        <span className="truncate text-[12px]" style={{ fontFamily: "var(--font-mono)", color: text === "Never" ? "var(--color-ink-3)" : "var(--color-ink)" }}>{text}</span>
        {stale && <span className="status status-warn" title={`Not seen in >${DEFAULT_STALE_DAYS} days`}>stale</span>}
      </div>
    );
  }

  const text = formatValue(col, vals);
  return (
    <div className="flex items-center px-3 overflow-hidden">
      <span className="truncate selectable text-[12px]" style={{ fontFamily: "var(--font-mono)", color: text ? "var(--color-ink)" : "var(--color-ink-3)" }} title={text}>{text || "—"}</span>
    </div>
  );
}
