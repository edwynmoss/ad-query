import { useState } from "react";
import type { ldap } from "../../wailsjs/go/models";
import { buildCsv, downloadCsv, CsvOptions, DEFAULT_CSV_OPTIONS } from "../lib/csv";
import type { DateFormat } from "../lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[520px] max-h-[86vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-4 py-3 border-b border-line">
          <DialogTitle className="display text-[16px] font-semibold">Export to CSV</DialogTitle>
        </DialogHeader>

        <div className="overflow-auto px-4 py-3.5 space-y-4">
          <div>
            <label className="eyebrow block mb-1">Rows</label>
            <ToggleGroup type="single" size="sm" variant="outline" value={scope} onValueChange={(v) => v && setScope(v as typeof scope)} className="w-full">
              <ToggleGroupItem value="all" className="flex-1">All ({allEntries.length.toLocaleString()})</ToggleGroupItem>
              <ToggleGroupItem value="selected" disabled={!hasSelection} className="flex-1">Selected ({selectedEntries.length})</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="eyebrow">Columns ({chosenCols.length}/{columns.length})</label>
              <div className="flex gap-2 text-[11px]">
                <button className="hover:underline text-brand" onClick={() => setCols(new Set(columns))}>All</button>
                <button className="hover:underline text-brand" onClick={() => setCols(new Set())}>None</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
              {columns.map((c) => (
                <button key={c} onClick={() => toggleCol(c)}
                  className={cn("inline-flex items-center h-[24px] px-2.5 rounded-md border text-[11.5px] font-mono cursor-pointer transition-colors",
                    cols.has(c) ? "border-brand bg-brand-soft text-brand" : "border-border bg-card opacity-55")}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="eyebrow block mb-1">Delimiter</label>
              <Select value={opts.delimiter} onValueChange={(val) => setOpts({ ...opts, delimiter: val })}>
                <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value=",">Comma</SelectItem><SelectItem value=";">Semicolon</SelectItem><SelectItem value={"\t"}>Tab</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="eyebrow block mb-1">Date format</label>
              <Select value={opts.dateFormat} onValueChange={(val) => setOpts({ ...opts, dateFormat: val as DateFormat })}>
                <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="iso">ISO-8601 (UTC)</SelectItem><SelectItem value="local">Local</SelectItem><SelectItem value="raw">Raw FILETIME</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="eyebrow block mb-1">Multi-value join</label>
              <Input className="h-8 font-mono" value={opts.multiValueJoin} onChange={(e) => setOpts({ ...opts, multiValueJoin: e.target.value })} />
            </div>
          </div>

          <div className="flex flex-col gap-2 text-[12px] text-ink-2">
            <label className="flex items-center gap-2 cursor-pointer"><Checkbox checked={opts.includeDN} onCheckedChange={(v) => setOpts({ ...opts, includeDN: !!v })} /> Include distinguished name (DN)</label>
            <label className="flex items-center gap-2 cursor-pointer"><Checkbox checked={opts.includeHeader} onCheckedChange={(v) => setOpts({ ...opts, includeHeader: !!v })} /> Include header row</label>
            <label className="flex items-center gap-2 cursor-pointer"><Checkbox checked={opts.bom} onCheckedChange={(v) => setOpts({ ...opts, bom: !!v })} /> UTF-8 BOM (Excel compatibility)</label>
          </div>
        </div>

        <DialogFooter className="px-4 py-3 border-t border-line bg-surface">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="px-5" onClick={doExport} disabled={rows.length === 0 || (chosenCols.length === 0 && !opts.includeDN)}>
            Export {rows.length.toLocaleString()} rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
