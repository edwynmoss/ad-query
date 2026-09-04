import { useEffect, useMemo, useState } from "react";
import { Loader2, Download, RefreshCw } from "lucide-react";
import { SearchCached, M365SignedIn, M365Check, M365LicenseReport } from "../../wailsjs/go/main/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/ui/status-badge";
import { ErrorBanner } from "@/components/ui/error-banner";
import { LicensePicker } from "./LicensePicker";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ldap, m365 } from "../../wailsjs/go/models";
import { OBJECT_TYPES, filterFor } from "../lib/objectTypes";
import { combineLastSeen, daysSince, isStale, LastSeen } from "../lib/lastseen";
import { csvValue } from "../lib/format";
import { rowsToCsv } from "../lib/bulk";
import { downloadCsv } from "../lib/csv";

interface Props {
  isAD: boolean;
  baseDN: string;
  onClose: () => void;
}

// A licensed user with both last-login signals resolved.
interface Holder {
  displayName: string;
  sAMAccountName: string;
  upn: string;
  licenses: string[];
  adFt: string;       // AD lastLogonTimestamp (raw)
  m365SignIn: string; // Entra last sign-in (ISO)
  seen: LastSeen;
}

const first = (e: ldap.Entry, a: string) => e.attributes?.[a]?.[0] ?? "";

export function ReclaimDialog({ isAD, baseDN, onClose }: Props) {
  const [phase, setPhase] = useState<"check" | "needsSignin" | "scanning" | "ready" | "error">("check");
  const [skus, setSkus] = useState<m365.LicenseSku[]>([]);
  const [selected, setSelected] = useState<string[]>([]); // product names; [] = all licenses
  const [all, setAll] = useState<Holder[]>([]);           // every licensed user in scope
  const [prov, setProv] = useState({ scanned: 0, matched: 0 }); // join provenance
  const [dormantOnly, setDormantOnly] = useState(false);
  const [days, setDays] = useState(90);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try { (await M365SignedIn()) ? scan(false) : setPhase("needsSignin"); }
      catch (e: any) { setError(String(e?.message ?? e)); setPhase("error"); }
    })();
  }, []);

  // refresh=true forces a live re-fetch (Rescan); otherwise cached results serve
  // an instant re-open.
  async function scan(refresh: boolean) {
    setPhase("scanning"); setError("");
    try {
      // Detected tenant subscriptions (for the picker) + the directory scan.
      const [report, cs] = await Promise.all([
        M365LicenseReport().catch(() => []),
        SearchCached(ldap.SearchRequest.createFrom({
          baseDN, scope: 2, filter: filterFor(OBJECT_TYPES.find((x) => x.key === "users") ?? OBJECT_TYPES[0], isAD),
          attributes: ["displayName", "sAMAccountName", "userPrincipalName", "mail", "lastLogonTimestamp"],
          pageSize: 1000, sizeLimit: 0,
        }), refresh),
      ]);
      setSkus(report ?? []);

      const entries = cs.result?.entries ?? [];
      const withId = entries.filter((e) => first(e, "userPrincipalName") || first(e, "mail"));
      const ids = Array.from(new Set(withId.map((e) => first(e, "userPrincipalName") || first(e, "mail"))));
      const byId = new Map<string, m365.User>();
      if (ids.length) for (const u of await M365Check(ids, refresh)) byId.set((u.identity || "").toLowerCase(), u);

      const out: Holder[] = [];
      let matched = 0;
      for (const e of entries) {
        const upn = first(e, "userPrincipalName") || first(e, "mail");
        const u = upn ? byId.get(upn.toLowerCase()) : undefined;
        if (!u || !u.exists) continue;
        matched++; // AD account that resolved to a real 365 user
        if (!u.licenses || u.licenses.length === 0) continue; // licensed users only
        const adFt = first(e, "lastLogonTimestamp");
        out.push({
          displayName: first(e, "displayName"), sAMAccountName: first(e, "sAMAccountName"), upn,
          licenses: u.licenses, adFt, m365SignIn: u.lastSignIn ?? "",
          seen: combineLastSeen(adFt, u.lastSignIn),
        });
      }
      setProv({ scanned: withId.length, matched });
      setAll(out); setPhase("ready");
    } catch (e: any) { setError(String(e?.message ?? e)); setPhase("error"); }
  }

  // Narrow to holders of the selected SKU(s) (empty selection = any license).
  const holders = useMemo(
    () => selected.length === 0 ? all : all.filter((h) => h.licenses.some((l) => selected.includes(l))),
    [all, selected],
  );

  // The visible set: all holders, or only the dormant ones when the toggle is on.
  const rows = useMemo(() => {
    const r = dormantOnly ? holders.filter((h) => isStale(h.seen, days)) : holders;
    return [...r].sort((a, b) => (daysSince(a.seen.date) ?? 1e9) > (daysSince(b.seen.date) ?? 1e9) ? -1 : 1);
  }, [holders, dormantOnly, days]);

  // Per-license counts across the visible set.
  const tally = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of rows) for (const l of j.licenses) if (selected.length === 0 || selected.includes(l)) m.set(l, (m.get(l) ?? 0) + 1);
    return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }, [rows, selected]);

  function exportCsv() {
    const cols = ["User", "UPN", "Licenses", "AD last logon", "365 last sign-in", "Last seen", "Days idle"];
    const out = rows.map((j) => ({
      User: j.displayName || j.sAMAccountName, UPN: j.upn, Licenses: j.licenses.join("; "),
      "AD last logon": csvValue("lastLogonTimestamp", [j.adFt]), "365 last sign-in": j.m365SignIn,
      "Last seen": j.seen.date ? j.seen.date.toISOString() : "Never", "Days idle": daysSince(j.seen.date)?.toString() ?? "",
    }));
    const tag = dormantOnly ? `dormant-${days}d` : "licensed";
    downloadCsv(`adquery-${tag}-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(cols, out));
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[720px] max-h-[88vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-5 py-3.5 text-left border-b border-line">
          <DialogTitle className="display text-[16px] font-semibold">Licenses &amp; sign-in</DialogTitle>
          <DialogDescription className="text-[12px] text-ink-3">Microsoft 365 licensed users in this location, with last sign-in. Filter by licence and, optionally, by dormancy to find seats to reclaim.</DialogDescription>
        </DialogHeader>

        {/* Controls */}
        <div className="px-5 py-3 border-b border-line space-y-3">
          <div className="flex items-center gap-2">
            <span className="eyebrow shrink-0">Licence</span>
            <div className="flex-1 min-w-0"><LicensePicker skus={skus} selected={selected} onChange={setSelected} /></div>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => scan(true)} disabled={phase === "scanning"}>
              {phase === "scanning" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Rescan
            </Button>
          </div>
          <label className="flex items-center gap-2 text-[12.5px] cursor-pointer">
            <Checkbox checked={dormantOnly} onCheckedChange={(v) => setDormantOnly(!!v)} disabled={phase !== "ready"} />
            Only dormant, idle more than
            <Input type="number" min={1} className="w-16 h-8 text-center" value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 90))} disabled={!dormantOnly || phase !== "ready"} />
            days
          </label>
        </div>

        <div className="overflow-auto px-5 py-4 min-h-[160px]">
          {phase === "needsSignin" && <div className="text-[12.5px] text-ink-2">Sign in to Microsoft 365 first (the cloud button). Licences and cloud sign-ins come from Entra.</div>}
          {phase === "scanning" && <div className="flex items-center gap-2 text-[12.5px] text-ink-2"><Loader2 size={14} className="animate-spin" /> Joining licensed users with last-login…</div>}
          {phase === "error" && <ErrorBanner error={error} />}

          {phase === "ready" && (
            <p className="text-[11px] text-ink-3 mb-3">
              Joined <span className="text-ink-2">{prov.scanned.toLocaleString()}</span> AD accounts → <span className="text-ink-2">{prov.matched.toLocaleString()}</span> matched a 365 user (by UPN/email) → <span className="text-ink-2">{all.length.toLocaleString()}</span> licensed.
            </p>
          )}

          {phase === "ready" && all.length === 0 && (
            <div className="text-[12.5px] text-ink-2 space-y-2">
              <p className="font-medium text-ink">No licensed Microsoft 365 users matched.</p>
              <p>None of the accounts in this location resolved to a 365 user with an assigned licence. That is commonly because the directory accounts have no <span className="font-mono">userPrincipalName</span>/<span className="font-mono">mail</span> matching 365 (e.g. a non-AD test directory), none currently hold a licence, or the location has no licensed users (widen “Search in”).</p>
            </div>
          )}

          {phase === "ready" && all.length > 0 && (
            <>
              <div className="flex items-baseline gap-2 mb-2.5">
                <span className="display text-[20px] font-semibold">{rows.length}</span>
                <span className="text-[12.5px] text-ink-2">{dormantOnly ? "dormant" : "licensed"} users{selected.length ? ` with ${selected.length === 1 ? selected[0] : selected.length + " licences"}` : ""} · {all.length} licensed in scope</span>
              </div>
              {tally.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="eyebrow self-center">{dormantOnly ? "Reclaimable" : "Holders"}</span>
                  {tally.map((r) => <StatusBadge key={r.label} tone={dormantOnly ? "success" : "neutral"}>{r.count} × {r.label}</StatusBadge>)}
                </div>
              )}
              <table className="w-full text-[12px] tabular-nums">
                <thead><tr className="border-b border-line-strong">
                  <th className="text-left eyebrow py-1.5">User</th><th className="text-left eyebrow py-1.5">Licences</th><th className="text-left eyebrow py-1.5">Last seen</th><th className="text-right eyebrow py-1.5">Days idle</th>
                </tr></thead>
                <tbody>
                  {rows.slice(0, 200).map((j) => (
                    <tr key={j.upn} className="border-b border-line">
                      <td className="py-1.5">{j.displayName || j.sAMAccountName}<span className="ml-1.5 text-[10.5px] text-ink-3 font-mono">{j.upn}</span></td>
                      <td className="py-1.5 text-ink-2">{j.licenses.join(", ")}</td>
                      <td className="py-1.5 font-mono">{j.seen.date ? `${j.seen.date.toISOString().slice(0, 10)} (${j.seen.source})` : "Never"}</td>
                      <td className={"text-right py-1.5 font-mono " + (isStale(j.seen, days) ? "text-warning" : "text-ink-3")}>{daysSince(j.seen.date) ?? "∞"}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-ink-3">{dormantOnly ? `No matching users idle more than ${days} days. 🎉` : "No users hold the selected licence."}</td></tr>}
                </tbody>
              </table>
              {rows.length > 200 && <p className="text-[11px] mt-2 text-ink-3">Showing first 200 of {rows.length}. Export for the full list.</p>}
            </>
          )}
        </div>

        <DialogFooter className="px-5 py-3.5 border-t border-line">
          <p className="text-[11px] flex-1 min-w-0 mr-auto text-left text-ink-3">
            Scans accounts in your AD, then matches them to 365 licences. Cloud-only users (no AD account) aren't included.
          </p>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button className="px-5" onClick={exportCsv} disabled={phase !== "ready" || rows.length === 0}><Download size={14} /> Export {rows.length} users</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
