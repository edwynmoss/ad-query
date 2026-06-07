import { memo, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Download, ArrowUp, ArrowDown, Loader2, Cloud } from "lucide-react";
import type { ldap } from "../../wailsjs/go/models";
import { formatValue, decodeUAC } from "../lib/format";
import { combineLastSeen, isStale, DEFAULT_STALE_DAYS } from "../lib/lastseen";
import { ExportDialog } from "./ExportDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { labelFor } from "@/lib/attrLabels";

interface Props {
  result: ldap.SearchResult | null;
  loading?: boolean;
  columns: string[];
  selectedDN: string | null;
  onSelectRow: (e: ldap.Entry) => void;
  signedIn365?: boolean;
  onCheck365?: () => void;
}

const ROW_H = 33;

// Identifier-ish columns read better monospaced (hoisted so it isn't rebuilt
// per cell render).
const MONO_COLS = new Set(["distinguishedname", "objectsid", "objectguid", "samaccountname", "userprincipalname", "uid", "mail", "telephonenumber", "mobile", "employeenumber"]);

function uacStatusTone(flag: string): StatusTone {
  if (flag === "Disabled" || flag === "Locked out" || flag === "Password expired") return "critical";
  if (flag === "Password never expires" || flag === "Trusted for delegation") return "warning";
  return "neutral";
}

export function ResultsGrid({ result, loading, columns, selectedDN, onSelectRow, signedIn365, onCheck365 }: Props) {
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
    if (loading) {
      return (
        <div className="flex-1 grid place-items-center bg-page">
          <div className="flex items-center gap-2.5 text-[13px] text-ink-2">
            <Loader2 size={16} className="animate-spin" /> Searching the directory…
          </div>
        </div>
      );
    }
    return (
      <div className="flex-1 grid place-items-center bg-page">
        <div className="text-center">
          <div className="display text-[19px] text-ink-2">No record set</div>
          <p className="text-[12.5px] mt-1 text-ink-3">Compose a query and run it to draw results into the ledger.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-page">
      {/* Ledger caption / toolbar */}
      <div className="flex items-center justify-between px-4 h-10 shrink-0 border-y border-line">
        <div className="flex items-baseline gap-2">
          <span className="display text-[15px]">Results</span>
          <span className="text-[12px] text-ink-3 flex items-center gap-1.5">
            {loading && <Loader2 size={12} className="animate-spin" />}
            {result.count.toLocaleString()} records{checked.size > 0 ? ` · ${checked.size} marked` : ""}{result.truncated ? " · truncated" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {signedIn365 && (
            <Button variant="outline" size="sm" onClick={onCheck365} disabled={entries.length === 0} title="Keep only users holding a 365 licence and add licence + sign-in columns">
              <Cloud size={13} /> Check 365
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowExport(true)} disabled={entries.length === 0}>
            <Download size={13} /> Export CSV{checked.size > 0 ? ` (${checked.size})` : ""}
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto">
        {/* Header */}
        <div className="grid sticky top-0 z-10 bg-page border-b-2 border-line-strong" style={{ gridTemplateColumns: gridCols }}>
          <div className="flex items-center justify-center"><Checkbox checked={checked.size === entries.length && entries.length > 0} onCheckedChange={toggleAll} aria-label="mark all" /></div>
          <div className="flex items-center justify-end pr-2 eyebrow">#</div>
          {columns.map((col) => (
            <button key={col} onClick={() => toggleSort(col)} className="flex items-center gap-1 h-9 px-3 text-left eyebrow hover:text-ink" title={`${col} — sort`}>
              <span className="truncate">{labelFor(col)}</span>
              {sortCol === col && (sortAsc ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
            </button>
          ))}
        </div>

        {/* Virtualized ledger body */}
        <div className="relative" style={{ height: rowVirt.getTotalSize() }}>
          {rowVirt.getVirtualItems().map((vi) => {
            const e = sorted[vi.index];
            const isSel = selectedDN === e.dn;
            return (
              <div key={e.dn} onClick={() => onSelectRow(e)}
                className={"grid absolute left-0 w-full cursor-pointer border-b border-line border-l-2 " +
                  (isSel ? "bg-brand-soft border-l-brand" : "border-l-transparent hover:bg-sunken")}
                style={{ top: vi.start, height: ROW_H, gridTemplateColumns: gridCols }}
              >
                <div className="flex items-center justify-center" onClick={(ev) => ev.stopPropagation()}>
                  <Checkbox checked={checked.has(e.dn)} onCheckedChange={() => toggleCheck(e.dn)} aria-label="mark row" />
                </div>
                <div className="flex items-center justify-end pr-2 text-[11px] tabular-nums text-ink-3 font-mono">{vi.index + 1}</div>
                {columns.map((col) => <Cell key={col} col={col} entry={e} />)}
              </div>
            );
          })}
          {entries.length === 0 && <div className="px-4 py-12 text-center text-[13px] text-ink-3">No entries matched this query.</div>}
        </div>
      </div>

      {showExport && (
        <ExportDialog allEntries={entries} selectedEntries={entries.filter((e) => checked.has(e.dn))} columns={columns} onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}

const Cell = memo(function Cell({ col, entry }: { col: string; entry: ldap.Entry }) {
  const vals = entry.attributes?.[col];
  if (col.toLowerCase() === "useraccountcontrol" && vals && vals.length) {
    const flags = decodeUAC(vals[0]);
    return (
      <div className="flex items-center gap-1.5 px-3 overflow-hidden" title={vals[0]}>
        {flags.length === 0
          ? <span className="text-[11px] text-ink-3">Enabled</span>
          : flags.map((f) => <StatusBadge key={f} tone={uacStatusTone(f)}>{f}</StatusBadge>)}
      </div>
    );
  }
  const lc = col.toLowerCase();
  if ((lc === "lastlogontimestamp" || lc === "lastlogon") && vals && vals.length) {
    const text = formatValue(col, vals); // date or "Never"
    const stale = isStale(combineLastSeen(vals[0]));
    return (
      <div className="flex items-center gap-1.5 px-3 overflow-hidden" title={text}>
        <span className={"truncate text-[12px] font-mono " + (text === "Never" ? "text-ink-3" : "text-ink")}>{text}</span>
        {stale && <StatusBadge tone="warning" title={`Not seen in >${DEFAULT_STALE_DAYS} days`}>stale</StatusBadge>}
      </div>
    );
  }

  const text = formatValue(col, vals);
  const mono = MONO_COLS.has(lc);
  return (
    <div className="flex items-center px-3 overflow-hidden">
      <span className={"truncate selectable " + (mono ? "font-mono text-[12px]" : "text-[13px]") + " " + (text ? "text-ink" : "text-ink-3")}
        title={text}>{text || "—"}</span>
    </div>
  );
});
