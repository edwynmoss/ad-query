import { useEffect, useMemo, useState } from "react";
import { Loader2, Download, RefreshCw } from "lucide-react";
import { Search } from "../../wailsjs/go/main/App";
import { ldap } from "../../wailsjs/go/models";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/ui/status-badge";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { escapeLdapValue } from "../lib/filterBuilder";
import { assessRisk, RISK_ATTRS, riskTone, riskRank, PRIVILEGED_GROUPS, type RiskAssessment } from "../lib/risk";
import { combineLastSeen, daysSince, LastSeen } from "../lib/lastseen";
import { rowsToCsv } from "../lib/bulk";
import { downloadCsv } from "../lib/csv";

interface Props { baseDN: string; onClose: () => void }

interface PrivUser {
  dn: string;
  name: string;
  sam: string;
  groups: { group: string; direct: boolean }[];
  risk: RiskAssessment;
  seen: LastSeen;
}

const first = (e: ldap.Entry, a: string) => e.attributes?.[a]?.[0] ?? "";
// AD "members (including nested groups)" extensible match (LDAP_MATCHING_RULE_IN_CHAIN).
const IN_CHAIN = "1.2.840.113556.1.4.1941";

export function PrivilegedDialog({ baseDN, onClose }: Props) {
  const [phase, setPhase] = useState<"scanning" | "ready" | "error">("scanning");
  const [users, setUsers] = useState<PrivUser[]>([]);
  const [groupsFound, setGroupsFound] = useState(0);
  const [riskyOnly, setRiskyOnly] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { scan(); }, []);

  async function scan() {
    setPhase("scanning"); setError("");
    try {
      const byUser = new Map<string, PrivUser & { attrs: Record<string, string[]> }>();
      let found = 0;
      for (const g of PRIVILEGED_GROUPS) {
        const gres = await Search(ldap.SearchRequest.createFrom({
          baseDN, scope: 2,
          filter: `(&(objectClass=group)(|(sAMAccountName=${escapeLdapValue(g)})(cn=${escapeLdapValue(g)})))`,
          attributes: ["member"], pageSize: 100, sizeLimit: 0,
        }));
        const grp = gres.entries?.[0];
        if (!grp) continue;
        found++;
        const direct = new Set((grp.attributes?.member ?? []).map((d) => d.toLowerCase()));
        const mres = await Search(ldap.SearchRequest.createFrom({
          baseDN, scope: 2,
          filter: `(&(objectCategory=person)(objectClass=user)(memberOf:${IN_CHAIN}:=${grp.dn}))`,
          attributes: [...RISK_ATTRS, "displayName", "sAMAccountName", "userPrincipalName"], pageSize: 1000, sizeLimit: 0,
        }));
        for (const u of mres.entries ?? []) {
          const key = u.dn.toLowerCase();
          let rec = byUser.get(key);
          if (!rec) {
            rec = {
              dn: u.dn, name: first(u, "displayName") || first(u, "sAMAccountName") || u.dn,
              sam: first(u, "sAMAccountName") || first(u, "userPrincipalName"),
              groups: [], risk: { level: "Low", flags: [] }, seen: combineLastSeen(),
              attrs: u.attributes ?? {},
            };
            byUser.set(key, rec);
          }
          rec.groups.push({ group: g, direct: direct.has(key) });
        }
      }
      const recs: PrivUser[] = [...byUser.values()].map((r) => ({
        dn: r.dn, name: r.name, sam: r.sam, groups: r.groups,
        risk: assessRisk(r.attrs),
        seen: combineLastSeen(r.attrs.lastLogonTimestamp?.[0] || r.attrs.lastLogon?.[0]),
      }));
      recs.sort((a, b) => riskRank(b.risk.level) - riskRank(a.risk.level));
      setUsers(recs); setGroupsFound(found); setPhase("ready");
    } catch (e: any) { setError(String(e?.message ?? e)); setPhase("error"); }
  }

  const rows = useMemo(() => riskyOnly ? users.filter((u) => u.risk.level === "High" || u.risk.level === "Critical") : users, [users, riskyOnly]);
  const risky = useMemo(() => users.filter((u) => u.risk.level === "High" || u.risk.level === "Critical").length, [users]);

  function exportCsv() {
    const cols = ["User", "Account", "Privileged via", "Last seen", "Days idle", "Risk", "Reasons"];
    const out = rows.map((u) => ({
      User: u.name, Account: u.sam,
      "Privileged via": u.groups.map((g) => g.group + (g.direct ? "" : " (nested)")).join("; "),
      "Last seen": u.seen.date ? u.seen.date.toISOString() : "Never",
      "Days idle": daysSince(u.seen.date)?.toString() ?? "",
      Risk: u.risk.level, Reasons: u.risk.flags.map((f) => f.label).join("; "),
    }));
    downloadCsv(`adquery-privileged-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(cols, out));
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[720px] max-h-[88vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-5 py-3.5 text-left border-b border-line">
          <DialogTitle className="display text-[16px] font-semibold">Privileged access review</DialogTitle>
          <DialogDescription className="text-[12px] text-ink-3">Members of high-privilege groups (including nested), with risk flags.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 px-5 py-3 border-b border-line">
          <label className="flex items-center gap-2 text-[12.5px] cursor-pointer">
            <Checkbox checked={riskyOnly} onCheckedChange={(v) => setRiskyOnly(!!v)} disabled={phase !== "ready"} /> High &amp; Critical only
          </label>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={scan} disabled={phase === "scanning"}>
            {phase === "scanning" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Rescan
          </Button>
        </div>

        <div className="overflow-auto px-5 py-4 min-h-[160px]">
          {phase === "scanning" && <div className="flex items-center gap-2 text-[12.5px] text-ink-2"><Loader2 size={14} className="animate-spin" /> Resolving privileged group membership (incl. nested)…</div>}
          {phase === "error" && <ErrorBanner error={error} />}

          {phase === "ready" && users.length === 0 && (
            <div className="text-[12.5px] text-ink-2 space-y-2">
              <p className="font-medium text-ink">No privileged users found.</p>
              <p>None of the default privileged groups were found with members in this location — common against a non-AD test directory, or the groups live in a different OU (widen “Search in”).</p>
            </div>
          )}

          {phase === "ready" && users.length > 0 && (
            <>
              <div className="flex items-baseline gap-2 mb-3">
                <span className="display text-[20px] font-semibold">{rows.length}</span>
                <span className="text-[12.5px] text-ink-2">{riskyOnly ? "high-risk " : ""}privileged users · {groupsFound} groups · {risky} High/Critical</span>
              </div>
              <table className="w-full text-[12px] tabular-nums">
                <thead><tr className="border-b border-line-strong">
                  <th className="text-left eyebrow py-1.5">User</th><th className="text-left eyebrow py-1.5">Privileged via</th><th className="text-left eyebrow py-1.5">Last seen</th><th className="text-right eyebrow py-1.5">Risk</th>
                </tr></thead>
                <tbody>
                  {rows.slice(0, 200).map((u) => (
                    <tr key={u.dn} className="border-b border-line align-top">
                      <td className="py-1.5">{u.name}<span className="ml-1.5 text-[10.5px] text-ink-3 font-mono">{u.sam}</span></td>
                      <td className="py-1.5 text-ink-2">{u.groups.map((g) => g.group + (g.direct ? "" : " (nested)")).join(", ")}</td>
                      <td className="py-1.5 font-mono">{u.seen.date ? u.seen.date.toISOString().slice(0, 10) : "Never"}</td>
                      <td className="text-right py-1.5"><StatusBadge tone={riskTone(u.risk.level)} title={u.risk.flags.map((f) => f.label).join(", ")}>{u.risk.level}</StatusBadge></td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-ink-3">No High/Critical privileged users. 🎉</td></tr>}
                </tbody>
              </table>
              {rows.length > 200 && <p className="text-[11px] mt-2 text-ink-3">Showing first 200 of {rows.length} — export for the full list.</p>}
            </>
          )}
        </div>

        <DialogFooter className="px-5 py-3.5 border-t border-line">
          <p className="text-[11px] flex-1 min-w-0 mr-auto text-left text-ink-3">Nested membership resolved via the AD in-chain matching rule. Read-only.</p>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button className="px-5" onClick={exportCsv} disabled={phase !== "ready" || rows.length === 0}><Download size={14} /> Export {rows.length} users</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
