import { useEffect, useState } from "react";
import { X, Loader2, Upload, FileSpreadsheet, Download, CheckCircle2, AlertCircle, Cloud } from "lucide-react";
import { Search, M365SignedIn, M365Check } from "../../wailsjs/go/main/App";
import { ldap, m365 } from "../../wailsjs/go/models";
import type { QueryState } from "./QueryBar";
import { parseSpreadsheet, detectKey, chunk, chunkFilter, rowsToCsv, MATCH_ATTRS, MatchAttr, Sheet } from "../lib/bulk";
import { downloadCsv } from "../lib/csv";
import { csvValue } from "../lib/format";

interface Props {
  req: QueryState;
  onClose: () => void;
}

const CHUNK = 50;
const STATUS_COL = "AD Status";

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

  function exportResults() {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadCsv(`adquery-bulk-${stamp}.csv`, rowsToCsv(resultCols, resultRows));
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center" style={{ background: "rgba(0,0,0,0.40)" }} onClick={onClose}>
      <div className="card w-[560px] max-h-[88vh] flex flex-col" style={{ boxShadow: "0 16px 50px rgba(20,18,12,0.28)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid var(--color-line)" }}>
          <div>
            <span className="display text-[16px]" style={{ fontWeight: 600 }}>Bulk lookup from file</span>
            <p className="text-[12px]" style={{ color: "var(--color-ink-3)" }}>Import a CSV or Excel list and enrich it from the directory.</p>
          </div>
          <button className="btn btn-quiet btn-icon" onClick={onClose}><X size={15} /></button>
        </div>

        <div className="overflow-auto px-5 py-4 space-y-4">
          {/* File picker */}
          <label className="flex items-center gap-3 px-4 py-4 rounded-2xl cursor-pointer" style={{ border: "1px dashed var(--color-line-strong)", background: "var(--color-sunken)" }}>
            <Upload size={18} style={{ color: "var(--color-brand)" }} />
            <div className="flex-1">
              <div className="text-[12.5px] font-medium">{fileName || "Choose a .csv or .xlsx file"}</div>
              <div className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>{sheet ? `${sheet.rows.length} rows · ${sheet.headers.length} columns` : "Identities to look up (one per row)"}</div>
            </div>
            <input type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <span className="btn h-8">Browse</span>
          </label>

          {sheet && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="eyebrow block mb-1.5">Match column</label>
                  <select className="input" value={keyCol} onChange={(e) => setKeyCol(e.target.value)}>
                    {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="eyebrow block mb-1.5">Match on attribute</label>
                  <select className="input mono" value={matchAttr} onChange={(e) => setMatchAttr(e.target.value as MatchAttr)}>
                    {MATCH_ATTRS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="eyebrow block mb-1.5">Returns your selected columns</label>
                <div className="flex flex-wrap gap-1.5">{outAttrs.map((a) => <span key={a} className="token">{a}</span>)}</div>
              </div>
              <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: signedIn365 ? "var(--color-ink-2)" : "var(--color-ink-3)" }}>
                <input type="checkbox" checked={check365} disabled={!signedIn365} onChange={(e) => setCheck365(e.target.checked)} />
                <Cloud size={13} /> Also check Microsoft 365 {signedIn365 ? "(enabled · licenses · last sign-in)" : "— sign in via the ☁ button first"}
              </label>
            </>
          )}

          {error && <div className="text-[12px] px-4 py-2.5 rounded-2xl selectable" style={{ background: "var(--color-danger-weak)", color: "var(--color-danger)" }}>{error}</div>}

          {phase === "running" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--color-ink-2)" }}><Loader2 size={14} className="animate-spin" /> Looking up… {Math.round(progress * 100)}%</div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-sunken)" }}><div style={{ width: `${progress * 100}%`, height: "100%", background: "var(--color-brand)" }} /></div>
            </div>
          )}

          {phase === "done" && (
            <div className="rounded-2xl p-3.5 flex items-center gap-4 text-[12.5px]" style={{ border: "1px solid var(--color-line)", background: "var(--color-sunken)" }}>
              <span className="flex items-center gap-1.5" style={{ color: "var(--color-ok)" }}><CheckCircle2 size={15} /> {summary.found} found</span>
              <span className="flex items-center gap-1.5" style={{ color: "var(--color-ink-2)" }}><AlertCircle size={15} /> {summary.notFound} not found</span>
              {summary.multiple > 0 && <span style={{ color: "var(--color-warn)" }}>{summary.multiple} ambiguous</span>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5" style={{ borderTop: "1px solid var(--color-line)", background: "var(--color-surface)" }}>
          <button className="btn" onClick={onClose}>Close</button>
          {phase === "done"
            ? <button className="btn btn-primary px-5" onClick={exportResults}><Download size={14} /> Export results ({resultRows.length})</button>
            : <button className="btn btn-primary px-5" onClick={run} disabled={!sheet || !keyCol || phase === "running"}>
                <FileSpreadsheet size={14} /> Look up {sheet ? sheet.rows.length : 0}
              </button>}
        </div>
      </div>
    </div>
  );
}
