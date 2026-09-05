// Privileged access: members of the high-privilege groups, nested membership
// resolved, each with a risk level and the reasons behind it.
import { useEffect, useMemo, useState } from "react";
import { SearchCached } from "../../../wailsjs/go/main/App";
import { ldap } from "../../../wailsjs/go/models";
import { ErrorBanner } from "@/components/ui/error-banner";
import { escapeLdapValue } from "../../lib/filterBuilder";
import { assessRisk, RISK_ATTRS, riskRank, PRIVILEGED_GROUPS, type RiskAssessment } from "../../lib/risk";
import { combineLastSeen, daysSince, LastSeen } from "../../lib/lastseen";
import { rowsToCsv } from "../../lib/bulk";
import { downloadCsv } from "../../lib/csv";
import { RegisterFrame, InlineCheck } from "./RegisterFrame";

interface Props { baseDN: string; isAD: boolean }

interface PrivUser {
  dn: string;
  name: string;
  sam: string;
  groups: { group: string; direct: boolean }[];
  risk: RiskAssessment;
  seen: LastSeen;
}

const first = (e: ldap.Entry, a: string) => e.attributes?.[a]?.[0] ?? "";
const IN_CHAIN = "1.2.840.113556.1.4.1941";

export const riskFlagTone = (level: string) => (/critical|high/i.test(level) ? "crit" : /medium/i.test(level) ? "warn" : "");

export function PrivilegedRegister({ baseDN, isAD }: Props) {
  const [phase, setPhase] = useState<"scanning" | "ready" | "error">("scanning");
  const [users, setUsers] = useState<PrivUser[]>([]);
  const [groupsFound, setGroupsFound] = useState(0);
  const [riskyOnly, setRiskyOnly] = useState(false);
  const [error, setError] = useState("");
  const [at, setAt] = useState<number | null>(null);

  useEffect(() => { if (isAD) scan(false); }, [baseDN, isAD]); // eslint-disable-line react-hooks/exhaustive-deps

  async function scan(refresh: boolean) {
    setPhase("scanning"); setError("");
    try {
      const byUser = new Map<string, PrivUser & { attrs: Record<string, string[]> }>();
      let found = 0;
      for (const g of PRIVILEGED_GROUPS) {
        const gres = (await SearchCached(ldap.SearchRequest.createFrom({
          baseDN, scope: 2, filter: `(&(objectClass=group)(|(sAMAccountName=${escapeLdapValue(g)})(cn=${escapeLdapValue(g)})))`, attributes: ["member"], pageSize: 100, sizeLimit: 0,
        }), refresh)).result;
        const grp = gres?.entries?.[0];
        if (!grp) continue;
        found++;
        const direct = new Set((grp.attributes?.member ?? []).map((d) => d.toLowerCase()));
        const mres = (await SearchCached(ldap.SearchRequest.createFrom({
          baseDN, scope: 2, filter: `(&(objectCategory=person)(objectClass=user)(memberOf:${IN_CHAIN}:=${grp.dn}))`,
          attributes: [...RISK_ATTRS, "displayName", "sAMAccountName", "userPrincipalName"], pageSize: 1000, sizeLimit: 0,
        }), refresh)).result;
        for (const u of mres?.entries ?? []) {
          const key = u.dn.toLowerCase();
          let rec = byUser.get(key);
          if (!rec) {
            rec = { dn: u.dn, name: first(u, "displayName") || first(u, "sAMAccountName") || u.dn, sam: first(u, "sAMAccountName") || first(u, "userPrincipalName"), groups: [], risk: { level: "Low", flags: [] }, seen: combineLastSeen(), attrs: u.attributes ?? {} };
            byUser.set(key, rec);
          }
          rec.groups.push({ group: g, direct: direct.has(key) });
        }
      }
      const recs: PrivUser[] = [...byUser.values()].map((r) => ({ dn: r.dn, name: r.name, sam: r.sam, groups: r.groups, risk: assessRisk(r.attrs), seen: combineLastSeen(r.attrs.lastLogonTimestamp?.[0] || r.attrs.lastLogon?.[0]) }));
      recs.sort((a, b) => riskRank(b.risk.level) - riskRank(a.risk.level));
      setUsers(recs); setGroupsFound(found); setPhase("ready"); setAt(Date.now());
    } catch (e: any) { setError(String(e?.message ?? e)); setPhase("error"); }
  }

  const rows = useMemo(() => (riskyOnly ? users.filter((u) => u.risk.level === "High" || u.risk.level === "Critical") : users), [users, riskyOnly]);
  const risky = useMemo(() => users.filter((u) => u.risk.level === "High" || u.risk.level === "Critical").length, [users]);

  function exportCsv() {
    const cols = ["User", "Account", "Privileged via", "Last seen", "Days idle", "Risk", "Reasons"];
    const out = rows.map((u) => ({
      User: u.name, Account: u.sam, "Privileged via": u.groups.map((g) => g.group + (g.direct ? "" : " (nested)")).join("; "),
      "Last seen": u.seen.date ? u.seen.date.toISOString() : "Never", "Days idle": daysSince(u.seen.date)?.toString() ?? "",
      Risk: u.risk.level, Reasons: u.risk.flags.map((f) => f.label).join("; "),
    }));
    downloadCsv(`adquery-privileged-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(cols, out));
  }

  const asOf = at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  if (!isAD) {
    return (
      <RegisterFrame title="Privileged access" lede="Members of the high-privilege groups, nested membership included, with a risk level for each.">
        <div className="ledger-prose">
          <p><b>This register needs Active Directory.</b></p>
          <p>The privileged groups (Domain Admins, Enterprise Admins and the rest), the nested-membership matching rule and the risk flags are all Active Directory features. This directory reports as plain LDAP.</p>
          <p className="ledger-note">To review a group here, search for Groups and open the one you want; its members are listed in the row.</p>
        </div>
      </RegisterFrame>
    );
  }

  return (
    <RegisterFrame
      title="Privileged access"
      lede={<>Members of {PRIVILEGED_GROUPS.length} high-privilege groups, nested membership included, <InlineCheck checked={riskyOnly} onChange={setRiskyOnly} disabled={phase !== "ready"}>high and critical risk only</InlineCheck>.</>}
      meta={phase === "ready" ? <>
        <span><b>{rows.length.toLocaleString()}</b> {riskyOnly ? "high-risk " : ""}privileged users</span>
        <span>{groupsFound} groups found</span>
        <span>{risky} high or critical</span>
        {asOf && <span>as of {asOf} · <button className="ledger-link" onClick={() => scan(true)}>rescan</button></span>}
        <span className="flex-1" />
        <button className="ledger-link" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
      </> : phase === "scanning" ? <span>Resolving group membership…</span> : null}
    >
      {phase === "error" && <div className="p-6"><ErrorBanner error={error} /></div>}
      {phase === "ready" && users.length === 0 && (
        <div className="ledger-prose">
          <p><b>No privileged users found.</b></p>
          <p>None of the default privileged groups have members in this location. That is usual against a plain LDAP directory; against Active Directory, widen the location to the root of the domain.</p>
        </div>
      )}
      {phase === "ready" && users.length > 0 && (
        <table className="ledger-table">
          <thead><tr><th className="is-num">#</th><th>User</th><th>Privileged via</th><th>Last seen</th><th className="is-right">Risk</th></tr></thead>
          <tbody>
            {rows.slice(0, 500).map((u, i) => (
              <tr key={u.dn}>
                <td className="is-num mono">{i + 1}</td>
                <td>{u.name} <span className="mono is-dim">{u.sam}</span></td>
                <td className="is-2">{u.groups.map((g) => g.group + (g.direct ? "" : " (nested)")).join(", ")}</td>
                <td className="mono">{u.seen.date ? u.seen.date.toISOString().slice(0, 10) : "Never"}</td>
                <td className="is-right"><span className={"ledger-flag " + riskFlagTone(u.risk.level)} title={u.risk.flags.map((f) => f.label).join(", ")}>{u.risk.level}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="is-empty">No high or critical privileged users.</td></tr>}
          </tbody>
        </table>
      )}
      {phase === "ready" && rows.length > 500 && <p className="ledger-note" style={{ padding: "8px 26px" }}>Showing the first 500 of {rows.length.toLocaleString()}. Export for the full list.</p>}
      {phase === "ready" && <p className="ledger-note" style={{ padding: "14px 26px" }}>Nested membership is resolved with the directory's in-chain matching rule. Nothing is written.</p>}
    </RegisterFrame>
  );
}
