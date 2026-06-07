import { useState } from "react";
import { X } from "lucide-react";
import type { ldap } from "../../wailsjs/go/models";
import { buildCsv, downloadCsv, CsvOptions, DEFAULT_CSV_OPTIONS } from "../lib/csv";
import type { DateFormat } from "../lib/format";

interface Props {
  allEntries: ldap.Entry[];
  selectedEntries: ldap.Entry[];
  columns: string[];
  onClose: () => void;
}

export function ExportDialog({ allEntries, selectedEntries, columns, onClose }: Props) {
  const hasSelection = selectedEntries.length > 0;
  const [scope, setScope] = useState<"all" | "selected">(hasSelection ? "selected" : "all");
  const [cols, setCols] = useState<Set<string>>(new Set(columns));
  const [opts, setOpts] = useState<CsvOptions>(DEFAULT_CSV_OPTIONS);

  const rows = scope === "selected" ? selectedEntries : allEntries;
  const chosenCols = columns.filter((c) => cols.has(c));

  function toggleCol(c: string) {
    setCols((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });
  }
  function doExport() {
    const csv = buildCsv(rows, chosenCols, opts);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadCsv(`adquery-export-${stamp}.csv`, csv);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center" style={{ background: "rgba(0,0,0,0.40)" }} onClick={onClose}>
      <div className="card w-[520px] max-h-[86vh] flex flex-col" style={{ boxShadow: "0 16px 50px rgba(20,18,12,0.28)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--color-line)" }}>
          <span className="display text-[16px]" style={{ fontWeight: 600 }}>Export to CSV</span>
          <button className="btn btn-quiet btn-icon" onClick={onClose}><X size={15} /></button>
        </div>

        <div className="overflow-auto px-4 py-3.5 space-y-4">
          <div>
            <label className="eyebrow block mb-1">Rows</label>
            <div className="seg w-full">
              <button className="flex-1" data-active={scope === "all"} onClick={() => setScope("all")}>All ({allEntries.length.toLocaleString()})</button>
              <button className="flex-1" data-active={scope === "selected"} disabled={!hasSelection} onClick={() => setScope("selected")}>Selected ({selectedEntries.length})</button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="eyebrow">Columns ({chosenCols.length}/{columns.length})</label>
              <div className="flex gap-2 text-[11px]">
                <button className="hover:underline" style={{ color: "var(--color-accent)" }} onClick={() => setCols(new Set(columns))}>All</button>
                <button className="hover:underline" style={{ color: "var(--color-accent)" }} onClick={() => setCols(new Set())}>None</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
              {columns.map((c) => (
                <button key={c} onClick={() => toggleCol(c)} className="token cursor-pointer"
                  style={cols.has(c) ? { background: "var(--color-accent-weak)", color: "var(--color-accent)", borderColor: "var(--color-accent)" } : { opacity: 0.55 }}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="eyebrow block mb-1">Delimiter</label>
              <select className="input" value={opts.delimiter} onChange={(e) => setOpts({ ...opts, delimiter: e.target.value })}>
                <option value=",">Comma</option><option value=";">Semicolon</option><option value={"\t"}>Tab</option>
              </select>
            </div>
            <div>
              <label className="eyebrow block mb-1">Date format</label>
              <select className="input" value={opts.dateFormat} onChange={(e) => setOpts({ ...opts, dateFormat: e.target.value as DateFormat })}>
                <option value="iso">ISO-8601 (UTC)</option><option value="local">Local</option><option value="raw">Raw FILETIME</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="eyebrow block mb-1">Multi-value join</label>
              <input className="input mono" value={opts.multiValueJoin} onChange={(e) => setOpts({ ...opts, multiValueJoin: e.target.value })} />
            </div>
          </div>

          <div className="flex flex-col gap-2 text-[12px]" style={{ color: "var(--color-ink-2)" }}>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={opts.includeDN} onChange={(e) => setOpts({ ...opts, includeDN: e.target.checked })} /> Include distinguished name (DN)</label>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={opts.includeHeader} onChange={(e) => setOpts({ ...opts, includeHeader: e.target.checked })} /> Include header row</label>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={opts.bom} onChange={(e) => setOpts({ ...opts, bom: e.target.checked })} /> UTF-8 BOM (Excel compatibility)</label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3" style={{ borderTop: "1px solid var(--color-line)", background: "var(--color-surface)" }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary px-5" onClick={doExport} disabled={rows.length === 0 || (chosenCols.length === 0 && !opts.includeDN)}>
            Export {rows.length.toLocaleString()} rows
          </button>
        </div>
      </div>
    </div>
  );
}
