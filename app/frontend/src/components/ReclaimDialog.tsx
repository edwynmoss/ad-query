import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Download, RefreshCw } from "lucide-react";
import { Search, M365SignedIn, M365Check } from "../../wailsjs/go/main/App";
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
    <div className="fixed inset-0 z-50 grid place-items-center" style={{ background: "rgba(0,0,0,0.40)" }} onClick={onClose}>
      <div className="card w-[680px] max-h-[88vh] flex flex-col" style={{ boxShadow: "0 16px 50px rgba(20,18,12,0.28)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid var(--color-line)" }}>
          <div>
            <span className="display text-[16px]" style={{ fontWeight: 600 }}>Unused licenses</span>
            <p className="text-[12px]" style={{ color: "var(--color-ink-3)" }}>Licensed users dormant in both AD and Microsoft 365 — candidates to reclaim.</p>
          </div>
          <button className="btn btn-quiet btn-icon" onClick={onClose}><X size={15} /></button>
        </div>

        <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: "1px solid var(--color-line)" }}>
          <span className="text-[12.5px]">Idle more than</span>
          <input type="number" min={1} className="input w-20 text-center" value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 90))} disabled={phase !== "ready"} />
          <span className="text-[12.5px]">days</span>
          <button className="btn btn-quiet h-8 ml-auto" onClick={scan} disabled={phase === "scanning"}>
            {phase === "scanning" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Rescan
          </button>
        </div>

        <div className="overflow-auto px-5 py-4 min-h-[160px]">
          {phase === "needsSignin" && <div className="text-[12.5px]" style={{ color: "var(--color-ink-2)" }}>Sign in to Microsoft 365 first (the ☁ button) — licenses and cloud sign-ins come from Entra.</div>}
          {phase === "scanning" && <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--color-ink-2)" }}><Loader2 size={14} className="animate-spin" /> Joining licensed users with last-login…</div>}
          {phase === "error" && <div className="text-[12px] px-4 py-2.5 rounded-2xl selectable" style={{ background: "var(--color-danger-weak)", color: "var(--color-danger)" }}>{error}</div>}

          {phase === "ready" && (
            <>
              <div className="flex items-baseline gap-2 mb-2.5">
                <span className="display text-[20px]" style={{ fontWeight: 600 }}>{dormant.length}</span>
                <span className="text-[12.5px]" style={{ color: "var(--color-ink-2)" }}>dormant licensed users of {joined.length} licensed</span>
              </div>
              {reclaim.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="eyebrow self-center">Reclaimable</span>
                  {reclaim.map((r) => <span key={r.label} className="status status-ok">{r.count} × {r.label}</span>)}
                </div>
              )}
              <table className="w-full text-[12px]" style={{ fontVariantNumeric: "tabular-nums" }}>
                <thead><tr style={{ borderBottom: "1px solid var(--color-line-strong)" }}>
                  <th className="text-left eyebrow py-1.5">User</th><th className="text-left eyebrow py-1.5">Licenses</th><th className="text-left eyebrow py-1.5">Last seen</th><th className="text-right eyebrow py-1.5">Days idle</th>
                </tr></thead>
                <tbody>
                  {dormant.slice(0, 200).map((j) => (
                    <tr key={j.upn} style={{ borderBottom: "1px solid var(--color-line)" }}>
                      <td className="py-1.5">{j.displayName || j.sAMAccountName}<span className="ml-1.5 text-[10.5px]" style={{ color: "var(--color-ink-3)", fontFamily: "var(--font-mono)" }}>{j.upn}</span></td>
                      <td className="py-1.5" style={{ color: "var(--color-ink-2)" }}>{j.licenses.join(", ")}</td>
                      <td className="py-1.5" style={{ fontFamily: "var(--font-mono)" }}>{j.seen.date ? `${j.seen.date.toISOString().slice(0, 10)} (${j.seen.source})` : "Never"}</td>
                      <td className="text-right py-1.5" style={{ fontFamily: "var(--font-mono)", color: "var(--color-warn)" }}>{daysSince(j.seen.date) ?? "∞"}</td>
                    </tr>
                  ))}
                  {dormant.length === 0 && <tr><td colSpan={4} className="py-6 text-center" style={{ color: "var(--color-ink-3)" }}>No dormant licensed users past {days} days. 🎉</td></tr>}
                </tbody>
              </table>
              {dormant.length > 200 && <p className="text-[11px] mt-2" style={{ color: "var(--color-ink-3)" }}>Showing first 200 of {dormant.length} — export for the full list.</p>}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderTop: "1px solid var(--color-line)" }}>
          <p className="text-[11px] flex-1 min-w-0" style={{ color: "var(--color-ink-3)" }}>
            Scans accounts in your AD, then matches them to 365 licenses — cloud-only users (no AD account) aren't included.
          </p>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary px-5" onClick={exportCsv} disabled={phase !== "ready" || dormant.length === 0}><Download size={14} /> Export {dormant.length} users</button>
        </div>
      </div>
    </div>
  );
}
