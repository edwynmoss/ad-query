// Licences: Microsoft 365 seats held by accounts in this location, joined to
// their AD and cloud last sign-in, so dormant seats can be reclaimed.
import { useEffect, useMemo, useState } from "react";
import { SearchCached, M365Check, M365LicenseReport } from "../../../wailsjs/go/main/App";
import { ldap, m365 } from "../../../wailsjs/go/models";
import { ErrorBanner } from "@/components/ui/error-banner";
import { LicensePicker } from "../LicensePicker";
import { OBJECT_TYPES, filterFor } from "../../lib/objectTypes";
import { combineLastSeen, daysSince, isStale, LastSeen } from "../../lib/lastseen";
import { csvValue } from "../../lib/format";
import { rowsToCsv } from "../../lib/bulk";
import { downloadCsv } from "../../lib/csv";
import { RegisterFrame, InlineNumber, InlineCheck } from "./RegisterFrame";

interface Props {
  isAD: boolean;
  baseDN: string;
  signedIn365: boolean;
  onConnect365: () => void;
}

interface Holder {
  displayName: string;
  sAMAccountName: string;
  upn: string;
  licenses: string[];
  adFt: string;
  m365SignIn: string;
  seen: LastSeen;
}

const first = (e: ldap.Entry, a: string) => e.attributes?.[a]?.[0] ?? "";

export function LicencesRegister({ isAD, baseDN, signedIn365, onConnect365 }: Props) {
  const [phase, setPhase] = useState<"idle" | "scanning" | "ready" | "error">("idle");
  const [skus, setSkus] = useState<m365.LicenseSku[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [all, setAll] = useState<Holder[]>([]);
  const [prov, setProv] = useState({ scanned: 0, matched: 0 });
  const [dormantOnly, setDormantOnly] = useState(false);
  const [days, setDays] = useState(90);
  const [error, setError] = useState("");
  const [at, setAt] = useState<number | null>(null);

  useEffect(() => { if (signedIn365) scan(false); else setPhase("idle"); }, [signedIn365, baseDN]); // eslint-disable-line react-hooks/exhaustive-deps

  async function scan(refresh: boolean) {
    setPhase("scanning"); setError("");
    try {
      const [report, cs] = await Promise.all([
        M365LicenseReport().catch(() => []),
        SearchCached(ldap.SearchRequest.createFrom({
          baseDN, scope: 2, filter: filterFor(OBJECT_TYPES.find((x) => x.key === "users") ?? OBJECT_TYPES[0], isAD),
          attributes: ["displayName", "sAMAccountName", "userPrincipalName", "mail", "lastLogonTimestamp"], pageSize: 1000, sizeLimit: 0,
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
        matched++;
        if (!u.licenses || u.licenses.length === 0) continue;
        const adFt = first(e, "lastLogonTimestamp");
        out.push({ displayName: first(e, "displayName"), sAMAccountName: first(e, "sAMAccountName"), upn, licenses: u.licenses, adFt, m365SignIn: u.lastSignIn ?? "", seen: combineLastSeen(adFt, u.lastSignIn) });
      }
      setProv({ scanned: withId.length, matched });
      setAll(out); setPhase("ready"); setAt(Date.now());
    } catch (e: any) { setError(String(e?.message ?? e)); setPhase("error"); }
  }

  const holders = useMemo(() => (selected.length === 0 ? all : all.filter((h) => h.licenses.some((l) => selected.includes(l)))), [all, selected]);
  const rows = useMemo(() => {
    const r = dormantOnly ? holders.filter((h) => isStale(h.seen, days)) : holders;
    return [...r].sort((a, b) => ((daysSince(a.seen.date) ?? 1e9) > (daysSince(b.seen.date) ?? 1e9) ? -1 : 1));
  }, [holders, dormantOnly, days]);
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
    downloadCsv(`adquery-${dormantOnly ? `dormant-${days}d` : "licensed"}-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(cols, out));
  }

  const asOf = at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <RegisterFrame
      title="Licences"
      lede={<>Microsoft 365 seats held by accounts in this location, <InlineCheck checked={dormantOnly} onChange={setDormantOnly} disabled={phase !== "ready"}>only those idle more than</InlineCheck> <InlineNumber value={days} onChange={setDays} disabled={!dormantOnly || phase !== "ready"} /> days.</>}
      controls={signedIn365 && phase === "ready" ? <div className="ledger-controls-row"><span className="ledger-eyebrow">Licence</span><div className="flex-1 min-w-0"><LicensePicker skus={skus} selected={selected} onChange={setSelected} /></div></div> : undefined}
      meta={phase === "ready" ? <>
        <span><b>{rows.length.toLocaleString()}</b> {dormantOnly ? "dormant" : "licensed"} users{selected.length ? ` with ${selected.length === 1 ? selected[0] : selected.length + " licences"}` : ""}</span>
        <span>{prov.scanned.toLocaleString()} accounts scanned, {prov.matched.toLocaleString()} matched a 365 user, {all.length.toLocaleString()} licensed</span>
        {asOf && <span>as of {asOf} · <button className="ledger-link" onClick={() => scan(true)}>rescan</button></span>}
        <span className="flex-1" />
        <button className="ledger-link" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
      </> : phase === "scanning" ? <span>Joining licensed users with their last sign-in…</span> : null}
    >
      {phase === "idle" && !signedIn365 && (
        <div className="ledger-prose">
          <p><b>This register needs Microsoft 365.</b></p>
          <p>Licences and cloud sign-ins come from Entra. <button className="ledger-link" onClick={onConnect365}>Connect 365</button> from the running head and the scan starts on its own.</p>
          <p className="ledger-note">Accounts in your directory are matched to 365 users by user principal name or email. Cloud-only users with no directory account are not included.</p>
        </div>
      )}
      {phase === "error" && <div className="p-6"><ErrorBanner error={error} /></div>}
      {phase === "ready" && all.length === 0 && (
        <div className="ledger-prose">
          <p><b>No licensed Microsoft 365 users matched.</b></p>
          <p>None of the accounts in this location resolved to a 365 user holding a licence. Usually the accounts have no user principal name or email matching 365, or the location is too narrow.</p>
        </div>
      )}
      {phase === "ready" && all.length > 0 && (
        <>
          {tally.length > 0 && (
            <div className="ledger-tally">
              <div className="ledger-h4">{dormantOnly ? "Reclaimable seats" : "Seats held"}</div>
              <div className="ledger-leaders">
                {tally.map((r) => <div key={r.label} className="ledger-leader is-static"><span className="ledger-leader-label">{r.label}</span><i /><b className="mono">{r.count.toLocaleString()}</b></div>)}
              </div>
            </div>
          )}
          <table className="ledger-table">
            <thead><tr><th className="is-num">#</th><th>User</th><th>Licences</th><th>Last seen</th><th className="is-right">Days idle</th></tr></thead>
            <tbody>
              {rows.slice(0, 500).map((j, i) => (
                <tr key={j.upn}>
                  <td className="is-num mono">{i + 1}</td>
                  <td>{j.displayName || j.sAMAccountName} <span className="mono is-dim">{j.upn}</span></td>
                  <td className="is-2">{j.licenses.join(", ")}</td>
                  <td className="mono">{j.seen.date ? `${j.seen.date.toISOString().slice(0, 10)} (${j.seen.source})` : "Never"}</td>
                  <td className={"is-right mono " + (isStale(j.seen, days) ? "is-warn" : "is-dim")}>{daysSince(j.seen.date) ?? "never"}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="is-empty">{dormantOnly ? `No users idle more than ${days} days.` : "No users hold the selected licence."}</td></tr>}
            </tbody>
          </table>
          {rows.length > 500 && <p className="ledger-note" style={{ padding: "8px 26px" }}>Showing the first 500 of {rows.length.toLocaleString()}. Export for the full list.</p>}
        </>
      )}
    </RegisterFrame>
  );
}
