// Bulk lookup: a CSV or Excel list of names, emails or usernames, each row
// matched to the directory and enriched with the Search register's columns.
import { useState } from "react";
import { Search, M365Check } from "../../../wailsjs/go/main/App";
import { ldap, m365 } from "../../../wailsjs/go/models";
import type { QueryState } from "../QueryBar";
import { parseSpreadsheet, detectKey, chunk, chunkFilter, rowsToCsv, MATCH_ATTRS, MatchAttr, Sheet } from "../../lib/bulk";
import { downloadCsv } from "../../lib/csv";
import { csvValue } from "../../lib/format";
import { ErrorBanner } from "@/components/ui/error-banner";
import { labelFor } from "../../lib/attrLabels";
import { RegisterFrame, InlineCheck } from "./RegisterFrame";

interface Props {
  req: QueryState;
  signedIn365: boolean;
  onPickColumns: () => void;
}

const CHUNK = 50;
const STATUS_COL = "AD Status";
const KEY_FIELD = "__bulkKey";

export function BulkRegister({ req, signedIn365, onPickColumns }: Props) {
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
  const [check365, setCheck365] = useState(false);

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
    } catch (e: any) { setError("Could not read file: " + String(e?.message ?? e)); setSheet(null); }
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
        const res = await Search(ldap.SearchRequest.createFrom({
          baseDN: req.baseDN, scope: req.scope ?? 2, filter: chunkFilter(req.filter, matchAttr, batch),
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
    } catch (e: any) { setError("Lookup failed: " + String(e?.message ?? e)); setPhase("pick"); return; }

    const cols = [...sheet.headers, ...outAttrs, STATUS_COL];
    let found = 0, notFound = 0, multiple = 0;
    const ids: string[] = [];
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
          const users = await M365Check(unique, false);
          const byId = new Map<string, m365.User>();
          for (const u of users) byId.set((u.identity || "").toLowerCase(), u);
          cols.push("365 Account", "365 Enabled", "365 Licenses", "365 Last sign-in");
          rows.forEach((row, i) => {
            const id = ids[i];
            const u = id ? byId.get(id.toLowerCase()) : undefined;
            row["365 Account"] = !id ? "" : u ? (u.exists ? "Found" : "Missing") : "";
            row["365 Enabled"] = u && u.exists ? (u.enabled ? "Yes" : "No") : "";
            row["365 Licenses"] = u && u.exists ? (u.licenses || []).join("; ") : "";
            row["365 Last sign-in"] = u && u.exists ? (u.lastSignIn || "") : "";
          });
        }
      } catch (e: any) { setError("365 check failed: " + String(e?.message ?? e)); }
    }
    setResultCols(cols); setResultRows(rows); setSummary({ found, notFound, multiple }); setPhase("done");
  }

  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const unmatched = phase === "done" ? resultRows.filter((r) => r[STATUS_COL] !== "Found") : [];

  return (
    <RegisterFrame
      title="Bulk lookup"
      lede={<>A CSV or Excel list of names, emails or usernames, each row matched to the directory and returned with <button className="ledger-link" onClick={onPickColumns}>{outAttrs.length} column{outAttrs.length === 1 ? "" : "s"}</button> from Search.</>}
      controls={
        <div className="ledger-controls-row">
          <label className="ledger-file">
            <input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
            <span className="ledger-file-name">{fileName || "Choose a .csv or .xlsx file"}</span>
            <span className="ledger-file-meta mono">{sheet ? `${sheet.rows.length} rows · ${sheet.headers.length} columns` : "one identity per row"}</span>
          </label>
          {sheet && (
            <>
              <span className="ledger-controls-word">match column</span>
              <select className="ledger-select" value={keyCol} onChange={(e) => setKeyCol(e.target.value)} aria-label="match column">
                {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <span className="ledger-controls-word">against</span>
              <select className="ledger-select" value={matchAttr} onChange={(e) => setMatchAttr(e.target.value as MatchAttr)} aria-label="match on field">
                {MATCH_ATTRS.map((a) => <option key={a} value={a}>{labelFor(a)}</option>)}
              </select>
            </>
          )}
        </div>
      }
      meta={sheet ? <>
        {signedIn365 && <InlineCheck checked={check365} onChange={setCheck365}>also check Microsoft 365</InlineCheck>}
        <span className="flex-1" />
        {phase === "done"
          ? <button className="ledger-link" onClick={() => downloadCsv(`adquery-bulk-${stamp()}.csv`, rowsToCsv(resultCols, resultRows))}>Export results ({resultRows.length.toLocaleString()})</button>
          : <button className="ledger-run" onClick={run} disabled={!keyCol || phase === "running"}>{phase === "running" ? `Looking up… ${Math.round(progress * 100)}%` : `Look up ${sheet.rows.length.toLocaleString()}`}</button>}
      </> : undefined}
    >
      {error && <div className="p-6 pb-0"><ErrorBanner error={error} /></div>}
      {!sheet && !error && (
        <div className="ledger-prose">
          <p>Drop in a spreadsheet and the app finds the matching directory object for every row. The first column that looks like a username, email or name is chosen automatically; change the match column or field above if it guessed wrong.</p>
          <p className="ledger-note">Rows that match nothing, or more than one object, are listed afterwards so partial results are never buried in the export.</p>
        </div>
      )}
      {phase === "done" && (
        <div className="ledger-prose">
          <dl className="ledger-facts-dl" style={{ marginTop: 0, maxWidth: 360 }}>
            <dt>Found</dt><dd className="mono">{summary.found.toLocaleString()}</dd>
            <dt>Not found</dt><dd className="mono">{summary.notFound.toLocaleString()}</dd>
            {summary.multiple > 0 && <><dt>Ambiguous</dt><dd className="mono is-warn">{summary.multiple.toLocaleString()}</dd></>}
          </dl>
          {unmatched.length > 0 && (
            <>
              <div className="ledger-h4">Needs attention, {unmatched.length.toLocaleString()} <button className="ledger-link" style={{ marginLeft: 10, textTransform: "none", letterSpacing: 0, fontWeight: 400 }} onClick={() => downloadCsv(`adquery-bulk-unmatched-${stamp()}.csv`, rowsToCsv(resultCols, unmatched))}>export these</button></div>
              <div className="ledger-lines" style={{ maxWidth: 560 }}>
                {unmatched.slice(0, 100).map((r, i) => (
                  <div key={i} className="ledger-line is-static">
                    <span className="ledger-line-text"><span className={"ledger-flag " + (r[STATUS_COL] === "Multiple matches" ? "warn" : "")}>{r[STATUS_COL] === "Multiple matches" ? "ambiguous" : "not found"}</span><span className="mono">{r[KEY_FIELD] || "(blank)"}</span></span>
                  </div>
                ))}
                {unmatched.length > 100 && <p className="ledger-note">And {unmatched.length - 100} more, in the exported file.</p>}
              </div>
              <p className="ledger-note">Correct these in the file, or change the match field, and look up again. Ambiguous means more than one object matched and only the first was returned.</p>
            </>
          )}
        </div>
      )}
    </RegisterFrame>
  );
}
