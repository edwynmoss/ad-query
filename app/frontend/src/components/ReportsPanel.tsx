import { useEffect, useState } from "react";
import { X, Download, ArrowUpRight, Loader2, FileBarChart, Cloud } from "lucide-react";
import { Search, M365SignedIn } from "../../wailsjs/go/main/App";
import { ldap } from "../../wailsjs/go/models";
import { QueryState, effectiveFilter } from "./QueryBar";
import { BUILTIN_REPORTS, resolveQuery } from "../lib/reports";
import { loadSavedQueries } from "../lib/savedQueries";
import { buildCsv, downloadCsv, DEFAULT_CSV_OPTIONS } from "../lib/csv";
import { LicenseReportDialog } from "./LicenseReportDialog";
import { StaleReportDialog } from "./StaleReportDialog";

interface Props {
  req: QueryState;
  isAD: boolean;
  onOpen: (q: QueryState) => void;     // load + run in the grid
  resultIdentities: string[];
  onClose: () => void;
}

export function ReportsPanel({ req, isAD, onOpen, resultIdentities, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showLicense, setShowLicense] = useState(false);
  const [showStale, setShowStale] = useState(false);
  const [signedIn365, setSignedIn365] = useState(false);
  const saved = loadSavedQueries();

  useEffect(() => { M365SignedIn().then(setSignedIn365).catch(() => {}); }, []);

  async function downloadQuery(name: string, q: QueryState) {
    setBusy(name);
    try {
      const res = await Search(ldap.SearchRequest.createFrom({
        baseDN: q.baseDN, scope: q.scope, filter: effectiveFilter(q),
        attributes: q.attributes, pageSize: 1000, sizeLimit: 0,
      }));
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`adquery-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}.csv`, buildCsv(res.entries ?? [], q.attributes, DEFAULT_CSV_OPTIONS));
    } catch (e: any) { alert("Report failed: " + String(e?.message ?? e)); } finally { setBusy(null); }
  }

  function row(key: string, name: string, description: string, actions: React.ReactNode) {
    return (
      <div key={key} className="flex items-start gap-3 py-2.5" style={{ borderBottom: "1px solid var(--color-line)" }}>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium">{name}</div>
          <div className="text-[11.5px]" style={{ color: "var(--color-ink-3)" }}>{description}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">{actions}</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center" style={{ background: "rgba(0,0,0,0.40)" }} onClick={onClose}>
      <div className="card w-[600px] max-h-[86vh] flex flex-col" style={{ boxShadow: "0 16px 50px rgba(20,18,12,0.28)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid var(--color-line)" }}>
          <div className="flex items-center gap-2"><FileBarChart size={16} style={{ color: "var(--color-accent)" }} /><span className="display text-[16px]" style={{ fontWeight: 600 }}>Reports</span></div>
          <button className="btn btn-quiet btn-icon" onClick={onClose}><X size={15} /></button>
        </div>

        <div className="overflow-auto px-5 py-2">
          <div className="eyebrow pt-2 pb-1">Built-in</div>
          {BUILTIN_REPORTS.map((r) => {
            if (r.kind === "license")
              return row(r.id, r.name, r.description, <button className="btn h-8" onClick={() => setShowLicense(true)}>Open <ArrowUpRight size={13} /></button>);
            if (r.kind === "stale")
              return row(r.id, r.name, r.description, <button className="btn h-8" onClick={() => setShowStale(true)}>Open <ArrowUpRight size={13} /></button>);
            const q = resolveQuery(r, isAD, req.baseDN);
            return row(r.id, r.name, r.description, <>
              <button className="btn btn-quiet h-8" onClick={() => onOpen(q)}>Open</button>
              <button className="btn h-8" disabled={busy === r.name} onClick={() => downloadQuery(r.name, q)}>
                {busy === r.name ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download
              </button>
            </>);
          })}

          <div className="eyebrow pt-3 pb-1">Saved queries</div>
          {saved.length === 0 && <div className="text-[12px] py-2" style={{ color: "var(--color-ink-3)" }}>None yet — save a query from the ⌘ Saved menu.</div>}
          {saved.map((s) =>
            row(s.id, s.name, `${s.query.attributes.length} columns · ${s.query.filter}`, <>
              <button className="btn btn-quiet h-8" onClick={() => onOpen(s.query)}>Open</button>
              <button className="btn h-8" disabled={busy === s.name} onClick={() => downloadQuery(s.name, s.query)}>
                {busy === s.name ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download
              </button>
            </>)
          )}
        </div>

        <div className="px-5 py-2.5 text-[11px] flex items-center gap-1.5" style={{ borderTop: "1px solid var(--color-line)", color: "var(--color-ink-3)" }}>
          <Cloud size={12} /> {signedIn365 ? "Signed in to 365 — stale & license reports include cloud data." : "Sign in to 365 (☁) for cloud sign-ins and license seats."}
        </div>
      </div>

      {showLicense && <LicenseReportDialog setIdentities={resultIdentities} onClose={() => setShowLicense(false)} />}
      {showStale && <StaleReportDialog isAD={isAD} baseDN={req.baseDN} onOpen={onOpen} onClose={() => setShowStale(false)} />}
    </div>
  );
}
