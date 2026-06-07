import { useEffect, useState } from "react";
import { Download, ArrowUpRight, Loader2, FileBarChart, Cloud } from "lucide-react";
import { Search, M365SignedIn } from "../../wailsjs/go/main/App";
import { ldap } from "../../wailsjs/go/models";
import { QueryState, effectiveFilter } from "./QueryBar";
import { BUILTIN_REPORTS, resolveQuery } from "../lib/reports";
import { loadSavedQueries } from "../lib/savedQueries";
import { buildCsv, downloadCsv, DEFAULT_CSV_OPTIONS } from "../lib/csv";
import { ReclaimDialog } from "./ReclaimDialog";
import { StaleReportDialog } from "./StaleReportDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  req: QueryState;
  isAD: boolean;
  onOpen: (q: QueryState) => void;     // load + run in the grid
  resultIdentities: string[];
  onClose: () => void;
}

export function ReportsPanel({ req, isAD, onOpen, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showReclaim, setShowReclaim] = useState(false);
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

  // Only one dialog at a time: hide Reports while a sub-report (Reclaim/Stale)
  // is open so the two Radix dialogs don't stack. ReportsPanel stays mounted, so
  // closing the sub-report returns the user to the Reports list.
  const subOpen = showReclaim || showStale;

  return (
    <>
      <Dialog open={!subOpen} onOpenChange={(o) => { if (!o && !subOpen) onClose(); }}>
        <DialogContent className="w-[600px] max-h-[86vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-5 py-3.5">
            <DialogTitle><span className="flex items-center gap-2"><FileBarChart size={16} className="text-brand" /><span className="display text-[16px] font-semibold">Reports</span></span></DialogTitle>
          </DialogHeader>

          <div className="overflow-auto px-5 py-2">
            <div className="eyebrow pt-2 pb-1">Built-in</div>
            {BUILTIN_REPORTS.map((r) => {
              if (r.kind === "license")
                return <ReportRow key={r.id} name={r.name} description={r.description} actions={<Button variant="outline" size="sm" onClick={() => setShowReclaim(true)}>Open <ArrowUpRight size={13} /></Button>} />;
              if (r.kind === "stale")
                return <ReportRow key={r.id} name={r.name} description={r.description} actions={<Button variant="outline" size="sm" onClick={() => setShowStale(true)}>Open <ArrowUpRight size={13} /></Button>} />;
              const q = resolveQuery(r, isAD, req.baseDN);
              return <ReportRow key={r.id} name={r.name} description={r.description} actions={<>
                <Button variant="ghost" size="sm" onClick={() => onOpen(q)}>Open</Button>
                <Button variant="outline" size="sm" disabled={busy === r.name} onClick={() => downloadQuery(r.name, q)}>
                  {busy === r.name ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download
                </Button>
              </>} />;
            })}

            <div className="eyebrow pt-3 pb-1">Saved queries</div>
            {saved.length === 0 && <div className="text-[12px] py-2 text-ink-3">None yet — save a query from the ⌘ Saved menu.</div>}
            {saved.map((s) =>
              <ReportRow key={s.id} name={s.name} description={`${s.query.attributes.length} columns · ${s.query.filter}`} actions={<>
                <Button variant="ghost" size="sm" onClick={() => onOpen(s.query)}>Open</Button>
                <Button variant="outline" size="sm" disabled={busy === s.name} onClick={() => downloadQuery(s.name, s.query)}>
                  {busy === s.name ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download
                </Button>
              </>} />
            )}
          </div>

          <div className="px-5 py-2.5 text-[11px] flex items-center gap-1.5 border-t border-line text-ink-3">
            <Cloud size={12} /> {signedIn365 ? "Signed in to 365 — stale & license reports include cloud data." : "Sign in to 365 (☁) for cloud sign-ins and license seats."}
          </div>
        </DialogContent>
      </Dialog>

      {showReclaim && <ReclaimDialog isAD={isAD} baseDN={req.baseDN} onClose={() => setShowReclaim(false)} />}
      {showStale && <StaleReportDialog isAD={isAD} baseDN={req.baseDN} onOpen={onOpen} onClose={() => setShowStale(false)} />}
    </>
  );
}

function ReportRow({ name, description, actions }: { name: string; description: string; actions: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-line">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium">{name}</div>
        <div className="text-[11.5px] text-ink-3">{description}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">{actions}</div>
    </div>
  );
}
