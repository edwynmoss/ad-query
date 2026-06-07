import { useEffect, useMemo, useState } from "react";
import { Loader2, Download, RefreshCw } from "lucide-react";
import { Search, M365SignedIn, M365Check } from "../../wailsjs/go/main/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
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

// One licensed user with both last-login signals already resolved.
interface Joined {
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
  const [joined, setJoined] = useState<Joined[]>([]);
  const [days, setDays] = useState(90);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try { (await M365SignedIn()) ? scan() : setPhase("needsSignin"); }
      catch (e: any) { setError(String(e?.message ?? e)); setPhase("error"); }
    })();
  }, []);

  async function scan() {
    setPhase("scanning"); setError("");
    try {
      const t = OBJECT_TYPES.find((x) => x.key === "users") ?? OBJECT_TYPES[0];
      const res = await Search(ldap.SearchRequest.createFrom({
        baseDN, scope: 2, filter: filterFor(t, isAD),
        attributes: ["displayName", "sAMAccountName", "userPrincipalName", "mail", "lastLogonTimestamp"],
        pageSize: 1000, sizeLimit: 0,
      }));
      const entries = res.entries ?? [];
      const ids = Array.from(new Set(entries.map((e) => first(e, "userPrincipalName") || first(e, "mail")).filter(Boolean)));
      const byId = new Map<string, m365.User>();
      if (ids.length) for (const u of await M365Check(ids)) byId.set((u.identity || "").toLowerCase(), u);

      const out: Joined[] = [];
      for (const e of entries) {
        const upn = first(e, "userPrincipalName") || first(e, "mail");
        const u = upn ? byId.get(upn.toLowerCase()) : undefined;
        if (!u || !u.exists || !u.licenses || u.licenses.length === 0) continue; // only licensed users can be reclaimed
        const adFt = first(e, "lastLogonTimestamp");
        out.push({
          displayName: first(e, "displayName"), sAMAccountName: first(e, "sAMAccountName"), upn,
          licenses: u.licenses, adFt, m365SignIn: u.lastSignIn ?? "",
          seen: combineLastSeen(adFt, u.lastSignIn),
        });
      }
      setJoined(out); setPhase("ready");
    } catch (e: any) { setError(String(e?.message ?? e)); setPhase("error"); }
  }

  // Dormant = licensed but not seen (AD or 365) within the window.
  const dormant = useMemo(() => joined.filter((j) => isStale(j.seen, days)).sort((a, b) => (daysSince(a.seen.date) ?? 1e9) > (daysSince(b.seen.date) ?? 1e9) ? -1 : 1), [joined, days]);

  // Seats you'd free, per product.
  const reclaim = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of dormant) for (const l of j.licenses) m.set(l, (m.get(l) ?? 0) + 1);
    return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }, [dormant]);

  function exportCsv() {
    const cols = ["User", "UPN", "Licenses", "AD last logon", "365 last sign-in", "Last seen", "Days idle"];
    const rows = dormant.map((j) => ({
      User: j.displayName || j.sAMAccountName, UPN: j.upn, Licenses: j.licenses.join("; "),
      "AD last logon": csvValue("lastLogonTimestamp", [j.adFt]), "365 last sign-in": j.m365SignIn,
      "Last seen": j.seen.date ? j.seen.date.toISOString() : "Never", "Days idle": daysSince(j.seen.date)?.toString() ?? "",
    }));
    downloadCsv(`adquery-reclaim-${days}d-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(cols, rows));
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[680px] max-h-[88vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-5 py-3.5 text-left border-b border-line">
          <DialogTitle className="display text-[16px] font-semibold">Unused licenses</DialogTitle>
          <DialogDescription className="text-[12px] text-ink-3">Licensed users dormant in both AD and Microsoft 365 — candidates to reclaim.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 px-5 py-3 border-b border-line">
          <span className="text-[12.5px]">Idle more than</span>
          <Input type="number" min={1} className="w-20 text-center" value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 90))} disabled={phase !== "ready"} />
          <span className="text-[12.5px]">days</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={scan} disabled={phase === "scanning"}>
            {phase === "scanning" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Rescan
          </Button>
        </div>

        <div className="overflow-auto px-5 py-4 min-h-[160px]">
          {phase === "needsSignin" && <div className="text-[12.5px] text-ink-2">Sign in to Microsoft 365 first (the ☁ button) — licenses and cloud sign-ins come from Entra.</div>}
          {phase === "scanning" && <div className="flex items-center gap-2 text-[12.5px] text-ink-2"><Loader2 size={14} className="animate-spin" /> Joining licensed users with last-login…</div>}
          {phase === "error" && <div className="text-[12px] px-4 py-2.5 rounded-lg selectable bg-critical-soft text-critical">{error}</div>}

          {phase === "ready" && joined.length === 0 && (
            <div className="text-[12.5px] text-ink-2 space-y-2">
              <p className="font-medium text-ink">No licensed Microsoft 365 users matched.</p>
              <p>None of the accounts in this location resolved to a 365 user with an assigned licence. Usually that means one of:</p>
              <ul className="list-disc pl-5 space-y-1 text-ink-3">
                <li>these directory accounts have no <span className="font-mono">userPrincipalName</span>/<span className="font-mono">mail</span> that matches 365 (common against a non-AD test directory),</li>
                <li>none of them currently hold a licence, or</li>
                <li>you're pointed at a location with no licensed users — widen "Search in".</li>
              </ul>
            </div>
          )}

          {phase === "ready" && joined.length > 0 && (
            <>
              <div className="flex items-baseline gap-2 mb-2.5">
                <span className="display text-[20px] font-semibold">{dormant.length}</span>
                <span className="text-[12.5px] text-ink-2">dormant of {joined.length} licensed users</span>
              </div>
              {reclaim.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="eyebrow self-center">Reclaimable</span>
                  {reclaim.map((r) => <StatusBadge key={r.label} tone="success">{r.count} × {r.label}</StatusBadge>)}
                </div>
              )}
              <table className="w-full text-[12px] tabular-nums">
                <thead><tr className="border-b border-line-strong">
                  <th className="text-left eyebrow py-1.5">User</th><th className="text-left eyebrow py-1.5">Licenses</th><th className="text-left eyebrow py-1.5">Last seen</th><th className="text-right eyebrow py-1.5">Days idle</th>
                </tr></thead>
                <tbody>
                  {dormant.slice(0, 200).map((j) => (
                    <tr key={j.upn} className="border-b border-line">
                      <td className="py-1.5">{j.displayName || j.sAMAccountName}<span className="ml-1.5 text-[10.5px] text-ink-3 font-mono">{j.upn}</span></td>
                      <td className="py-1.5 text-ink-2">{j.licenses.join(", ")}</td>
                      <td className="py-1.5 font-mono">{j.seen.date ? `${j.seen.date.toISOString().slice(0, 10)} (${j.seen.source})` : "Never"}</td>
                      <td className="text-right py-1.5 font-mono text-warning">{daysSince(j.seen.date) ?? "∞"}</td>
                    </tr>
                  ))}
                  {dormant.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-ink-3">All {joined.length} licensed users have signed in within {days} days — nothing to reclaim. 🎉</td></tr>}
                </tbody>
              </table>
              {dormant.length > 200 && <p className="text-[11px] mt-2 text-ink-3">Showing first 200 of {dormant.length} — export for the full list.</p>}
            </>
          )}
        </div>

        <DialogFooter className="px-5 py-3.5 border-t border-line">
          <p className="text-[11px] flex-1 min-w-0 mr-auto text-left text-ink-3">
            Scans accounts in your AD, then matches them to 365 licenses — cloud-only users (no AD account) aren't included.
          </p>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button className="px-5" onClick={exportCsv} disabled={phase !== "ready" || dormant.length === 0}><Download size={14} /> Export {dormant.length} users</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
