import { useEffect, useState } from "react";
import { Loader2, Upload, FileSpreadsheet, Download, CheckCircle2, AlertCircle, Cloud } from "lucide-react";
import { Search, M365SignedIn, M365Check } from "../../wailsjs/go/main/App";
import { ldap, m365 } from "../../wailsjs/go/models";
import type { QueryState } from "./QueryBar";
import { parseSpreadsheet, detectKey, chunk, chunkFilter, rowsToCsv, MATCH_ATTRS, MatchAttr, Sheet } from "../lib/bulk";
import { downloadCsv } from "../lib/csv";
import { csvValue } from "../lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ErrorBanner } from "@/components/ui/error-banner";
import { labelFor } from "../lib/attrLabels";
import { cn } from "@/lib/utils";

interface Props {
  req: QueryState;
  onClose: () => void;
}

const CHUNK = 50;
const STATUS_COL = "AD Status";
// The original lookup key, stashed on each row for the "needs attention" list.
// Not part of resultCols, so it never appears in the exported CSV. Needed
// because the match column can collide with a selected output column (which is
// blanked for not-found rows), clobbering the user's original input value.
const KEY_FIELD = "__bulkKey";

export function BulkImportDialog({ req, onClose }: Props) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [keyCol, setKeyCol] = useState("");
  const [matchAttr, setMatchAttr] = useState<MatchAttr>("sAMAccountName");
  const [phase, setPhase] = useState<"pick" | "running" | "done">("pick");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultCols, setResultCols] = useState<string[]>([]);
  const [resultRows, setResultRows] = useState<Record<string, string>[]>([]);
  const [summary, setSummary] = useState({ found: 0, notFound: 0, multiple: 0 });
  const [signedIn365, setSignedIn365] = useState(false);
  const [check365, setCheck365] = useState(false);

  useEffect(() => { M365SignedIn().then(setSignedIn365).catch(() => {}); }, []);

  const outAttrs = req.attributes;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null); setPhase("pick"); setResultRows([]);
    setFileName(file.name);
    try {
      const s = await parseSpreadsheet(file);
      if (s.headers.length === 0) { setError("No columns found in that file."); setSheet(null); return; }
      setSheet(s);
      const d = detectKey(s);
      setKeyCol(d.column); setMatchAttr(d.matchAttr);
    } catch (e: any) {
      setError("Could not read file: " + String(e?.message ?? e)); setSheet(null);
    }
  }

  async function run() {
    if (!sheet || !keyCol) return;
    setPhase("running"); setError(null); setProgress(0);

    const wanted = sheet.rows.map((r) => (r[keyCol] ?? "").trim());
    const uniques = Array.from(new Set(wanted.filter(Boolean).map((v) => v.toLowerCase())));
    const index = new Map<string, ldap.Entry[]>();

    try {
      const batches = chunk(Array.from(new Set(wanted.filter(Boolean))), CHUNK);
      let done = 0;
      for (const batch of batches) {
        const filter = chunkFilter(req.filter, matchAttr, batch);
        const res = await Search(ldap.SearchRequest.createFrom({
          baseDN: req.baseDN, scope: req.scope ?? 2, filter,
          attributes: Array.from(new Set([...outAttrs, matchAttr, "userPrincipalName", "mail"])), pageSize: 1000, sizeLimit: 0,
        }));
        for (const e of res.entries ?? []) {
          const key = (e.attributes?.[matchAttr]?.[0] ?? "").toLowerCase();
          if (!key) continue;
          const arr = index.get(key) ?? [];
          arr.push(e); index.set(key, arr);
        }
        done += batch.length;
        setProgress(done / Math.max(1, uniques.length));
      }
    } catch (e: any) {
      setError("Lookup failed: " + String(e?.message ?? e)); setPhase("pick"); return;
    }

    const cols = [...sheet.headers, ...outAttrs, STATUS_COL];
    let found = 0, notFound = 0, multiple = 0;
    const ids: string[] = []; // per-row UPN/mail for the optional 365 check
    const rows = sheet.rows.map((r) => {
      const keyRaw = (r[keyCol] ?? "").trim();
      const matches = keyRaw ? index.get(keyRaw.toLowerCase()) ?? [] : [];
      const status = matches.length === 0 ? "Not found" : matches.length > 1 ? "Multiple matches" : "Found";
      if (status === "Found") found++; else if (status === "Multiple matches") multiple++; else notFound++;
      const entry = matches[0];
      const out: Record<string, string> = { ...r };
      for (const a of outAttrs) out[a] = entry ? csvValue(a, entry.attributes?.[a]) : "";
      out[STATUS_COL] = status;
      out[KEY_FIELD] = keyRaw;
      ids.push(entry?.attributes?.userPrincipalName?.[0] || entry?.attributes?.mail?.[0] || (keyRaw.includes("@") ? keyRaw : ""));
      return out;
    });

    if (check365 && signedIn365) {
      try {
        const unique = Array.from(new Set(ids.filter(Boolean)));
        if (unique.length) {
          const users = await M365Check(unique);
          const byId = new Map<string, m365.User>();
          for (const u of users) byId.set((u.identity || "").toLowerCase(), u);
          cols.push("365 Account", "365 Enabled", "365 Licenses", "365 Last sign-in");
          rows.forEach((row, i) => {
            const id = ids[i];
            const u = id ? byId.get(id.toLowerCase()) : undefined;
            row["365 Account"] = !id ? "" : u ? (u.exists ? "Found" : "Missing") : "—";
            row["365 Enabled"] = u && u.exists ? (u.enabled ? "Yes" : "No") : "";
            row["365 Licenses"] = u && u.exists ? (u.licenses || []).join("; ") : "";
            row["365 Last sign-in"] = u && u.exists ? (u.lastSignIn || "") : "";
          });
        }
      } catch (e: any) {
        setError("365 check failed: " + String(e?.message ?? e));
      }
    }

    setResultCols(cols); setResultRows(rows); setSummary({ found, notFound, multiple }); setPhase("done");
  }

  function stampNow() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-"); }
  function exportResults() {
    downloadCsv(`adquery-bulk-${stampNow()}.csv`, rowsToCsv(resultCols, resultRows));
  }
  function exportUnmatched() {
    downloadCsv(`adquery-bulk-unmatched-${stampNow()}.csv`, rowsToCsv(resultCols, unmatched));
  }

  // Rows that didn't resolve to exactly one directory object — surfaced inline
  // so partial failures are visible, not buried in the exported CSV.
  const unmatched = phase === "done" ? resultRows.filter((r) => r[STATUS_COL] !== "Found") : [];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[560px] max-h-[88vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-5 py-3.5 border-b border-line">
          <DialogTitle className="display text-[16px] font-semibold">Bulk lookup from file</DialogTitle>
          <DialogDescription className="text-[12px] text-ink-3">Import a CSV or Excel list and enrich it from the directory.</DialogDescription>
        </DialogHeader>

        <div className="overflow-auto px-5 py-4 space-y-4">
          {/* File picker */}
          <label className="flex items-center gap-3 px-4 py-4 rounded-xl cursor-pointer border border-dashed border-line-strong bg-sunken">
            <Upload size={18} className="text-brand" />
            <div className="flex-1">
              <div className="text-[12.5px] font-medium">{fileName || "Choose a .csv or .xlsx file"}</div>
              <div className="text-[11px] text-ink-3">{sheet ? `${sheet.rows.length} rows · ${sheet.headers.length} columns` : "Identities to look up (one per row)"}</div>
            </div>
            <input type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <span className="inline-flex items-center justify-center h-8 px-3.5 rounded-md border border-border bg-card text-[12.5px] font-medium">Browse</span>
          </label>

          {sheet && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="eyebrow block mb-1.5">Match column</label>
                  <Select value={keyCol} onValueChange={(val) => setKeyCol(val)}>
                    <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {sheet.headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="eyebrow block mb-1.5">Match on field</label>
                  <Select value={matchAttr} onValueChange={(val) => setMatchAttr(val as MatchAttr)}>
                    <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MATCH_ATTRS.map((a) => <SelectItem key={a} value={a}>{labelFor(a)} <span className="text-ink-3 font-mono">{a}</span></SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="eyebrow block mb-1.5">Returns your selected columns</label>
                <div className="flex flex-wrap gap-1.5">{outAttrs.map((a) => <Badge key={a} variant="secondary" className="font-normal" title={a}>{labelFor(a)}</Badge>)}</div>
              </div>
              <label className={cn("flex items-center gap-2 text-[12px] cursor-pointer", signedIn365 ? "text-ink-2" : "text-ink-3")}>
                <Checkbox checked={check365} disabled={!signedIn365} onCheckedChange={(v) => setCheck365(!!v)} />
                <Cloud size={13} /> Also check Microsoft 365 {signedIn365 ? "(enabled · licenses · last sign-in)" : "— sign in via the ☁ button first"}
              </label>
            </>
          )}

          {error && <ErrorBanner error={error} />}

          {phase === "running" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[12.5px] text-ink-2"><Loader2 size={14} className="animate-spin" /> Looking up… {Math.round(progress * 100)}%</div>
              <div className="h-1.5 rounded-full overflow-hidden bg-sunken"><div className="h-full bg-brand" style={{ width: `${progress * 100}%` }} /></div>
            </div>
          )}

          {phase === "done" && (
            <div className="rounded-xl p-3.5 flex items-center gap-4 text-[12.5px] border border-line bg-sunken">
              <span className="flex items-center gap-1.5 text-success"><CheckCircle2 size={15} /> {summary.found} found</span>
              <span className="flex items-center gap-1.5 text-ink-2"><AlertCircle size={15} /> {summary.notFound} not found</span>
              {summary.multiple > 0 && <span className="flex items-center gap-1.5 text-warning"><AlertCircle size={15} /> {summary.multiple} ambiguous</span>}
            </div>
          )}

          {phase === "done" && unmatched.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="eyebrow">Needs attention ({unmatched.length})</span>
                <Button variant="outline" size="sm" onClick={exportUnmatched}><Download size={13} /> Export unmatched</Button>
              </div>
              <div className="rounded-lg border border-line divide-y divide-line max-h-[168px] overflow-auto">
                {unmatched.slice(0, 100).map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[12px]">
                    <span className="truncate font-mono">{r[KEY_FIELD] || "(blank)"}</span>
                    <StatusBadge tone={r[STATUS_COL] === "Multiple matches" ? "warning" : "neutral"}>{r[STATUS_COL] === "Multiple matches" ? "ambiguous" : "not found"}</StatusBadge>
                  </div>
                ))}
                {unmatched.length > 100 && <div className="px-3 py-1.5 text-[11px] text-ink-3">+{unmatched.length - 100} more — see the exported file.</div>}
              </div>
              <p className="text-[11px] text-ink-3">Correct these in your file (or change the match field) and import again. <span className="font-medium">Ambiguous</span> means more than one directory object matched — only the first was returned.</p>
            </div>
          )}
        </div>

        <DialogFooter className="px-5 py-3.5 border-t border-line bg-surface">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {phase === "done"
            ? <Button className="px-5" onClick={exportResults}><Download size={14} /> Export results ({resultRows.length})</Button>
            : <Button className="px-5" onClick={run} disabled={!sheet || !keyCol || phase === "running"}>
                <FileSpreadsheet size={14} /> Look up {sheet ? sheet.rows.length : 0}
              </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
