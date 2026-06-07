import { useEffect, useState } from "react";
import { Loader2, Download, Eye } from "lucide-react";
import { Search, M365SignedIn, M365Check } from "../../wailsjs/go/main/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ldap, m365 } from "../../wailsjs/go/models";
import type { QueryState } from "./QueryBar";
import { OBJECT_TYPES, filterFor } from "../lib/objectTypes";
import { combineAnd } from "../lib/filterBuilder";
import { combineLastSeen, daysSince, isStale, fileTimeDaysAgo } from "../lib/lastseen";
import { csvValue, decodeUAC } from "../lib/format";
import { rowsToCsv } from "../lib/bulk";
import { downloadCsv } from "../lib/csv";
import { toast } from "sonner";

interface Props {
  isAD: boolean;
  baseDN: string;
  onOpen: (q: QueryState) => void;
  onClose: () => void;
}

const first = (e: ldap.Entry, a: string) => e.attributes?.[a]?.[0] ?? "";
const COLUMNS = ["displayName", "sAMAccountName", "userPrincipalName", "userAccountControl", "lastLogonTimestamp"];

export function StaleReportDialog({ isAD, baseDN, onOpen, onClose }: Props) {
  const [days, setDays] = useState(90);
  const [enabledOnly, setEnabledOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [signedIn365, setSignedIn365] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { M365SignedIn().then(setSignedIn365).catch(() => {}); }, []);

  // AD-side stale filter: no lastLogonTimestamp, or older than the threshold.
  function query(): QueryState {
    const t = OBJECT_TYPES.find((x) => x.key === "users") ?? OBJECT_TYPES[0];
    const ft = fileTimeDaysAgo(days);
    let filter = combineAnd(filterFor(t, isAD), `(|(!(lastLogonTimestamp=*))(lastLogonTimestamp<=${ft}))`);
    if (enabledOnly && isAD) filter = combineAnd(filter, "(!(userAccountControl:1.2.840.113556.1.4.803:=2))");
    return { baseDN, scope: 2, filter, attributes: [...COLUMNS], conditions: [], matchOp: "and" };
  }

  function preview() { onOpen(query()); onClose(); }

  async function download() {
    setBusy(true); setError(null);
    try {
      const q = query();
      const res = await Search(ldap.SearchRequest.createFrom({
        baseDN: q.baseDN, scope: q.scope, filter: q.filter,
        attributes: [...COLUMNS, "mail"], pageSize: 1000, sizeLimit: 0,
      }));
      const entries = res.entries ?? [];

      const byId = new Map<string, m365.User>();
      if (signedIn365) {
        const ids = Array.from(new Set(entries.map((e) => first(e, "userPrincipalName") || first(e, "mail")).filter(Boolean)));
        if (ids.length) for (const u of await M365Check(ids)) byId.set((u.identity || "").toLowerCase(), u);
      }

      const staleCol = `Stale (>${days}d)`;
      const cols = ["displayName", "sAMAccountName", "userPrincipalName", "Account", "AD last logon", "365 last sign-in", "Last seen", "Days idle", staleCol];
      const rows: Record<string, string>[] = [];
      for (const e of entries) {
        const adFt = first(e, "lastLogonTimestamp");
        const upn = first(e, "userPrincipalName") || first(e, "mail");
        const cloud = upn ? byId.get(upn.toLowerCase()) : undefined;
        const ls = combineLastSeen(adFt, cloud?.lastSignIn);
        if (!isStale(ls, days)) continue; // a recent 365 sign-in rescues an AD-stale account
        rows.push({
          displayName: first(e, "displayName"),
          sAMAccountName: first(e, "sAMAccountName"),
          userPrincipalName: upn,
          Account: decodeUAC(first(e, "userAccountControl")).includes("Disabled") ? "Disabled" : "Enabled",
          "AD last logon": csvValue("lastLogonTimestamp", [adFt]),
          "365 last sign-in": signedIn365 ? (cloud?.lastSignIn ?? "") : "(not signed in)",
          "Last seen": ls.date ? ls.date.toISOString() : "Never",
          "Days idle": daysSince(ls.date)?.toString() ?? "",
          [staleCol]: "Yes",
        });
      }
      if (rows.length === 0) {
        toast.info(`No accounts stale beyond ${days} days${signedIn365 ? "" : " (AD only — sign in to 365 to fold in cloud sign-ins)"}.`);
        onClose(); return;
      }
      downloadCsv(`adquery-stale-${days}d-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(cols, rows));
      toast.success(`Stale report — ${rows.length.toLocaleString()} ${rows.length === 1 ? "account" : "accounts"} exported`);
      onClose();
    } catch (e: any) { setError(String(e?.message ?? e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[480px] max-h-[88vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-5 py-3.5 text-left border-b border-line">
          <DialogTitle className="display text-[16px] font-semibold">Stale accounts</DialogTitle>
        </DialogHeader>

        <div className="overflow-auto px-5 py-4 space-y-4">
          <div className="flex items-center gap-2 text-[13px]">
            <span>Not seen in the last</span>
            <Input type="number" min={1} className="w-20 h-8 text-center" value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 90))} />
            <span>days</span>
          </div>
          <label className="flex items-center gap-2 text-[12.5px] cursor-pointer text-ink-2">
            <Checkbox checked={enabledOnly} onCheckedChange={(v) => setEnabledOnly(!!v)} disabled={!isAD} /> Enabled accounts only
          </label>
          <p className="text-[12px] leading-relaxed px-4 py-3 rounded-2xl bg-sunken text-ink-2">
            <b className="text-ink">Preview</b> shows AD-stale candidates in the grid. <b className="text-ink">Download</b> also folds in
            {signedIn365 ? " Microsoft 365 sign-ins (a recent cloud sign-in clears an AD-stale account)" : " — sign in to 365 (☁) to include cloud sign-ins"} and exports the combined set.
          </p>
          {error && <ErrorBanner error={error} />}
        </div>

        <DialogFooter className="px-5 py-3.5 border-t border-line">
          <Button variant="outline" onClick={preview}><Eye size={14} /> Preview in grid</Button>
          <Button className="px-5" onClick={download} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
