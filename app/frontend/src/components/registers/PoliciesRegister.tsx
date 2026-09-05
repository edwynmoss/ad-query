// Policies: every Group Policy Object in the domain, where it is linked and
// who it is filtered to, so orphans, disabled links and odd filtering stand
// out. Read from the directory; the settings inside each policy are not.
import { useEffect, useMemo, useState } from "react";
import { PolicyInventory } from "../../../wailsjs/go/main/App";
import type { gpo } from "../../../wailsjs/go/models";
import { ErrorBanner } from "@/components/ui/error-banner";
import { rowsToCsv } from "../../lib/bulk";
import { downloadCsv } from "../../lib/csv";
import { RegisterFrame, InlineCheck } from "./RegisterFrame";

interface Props { isAD: boolean }

const AUTHENTICATED_USERS = "S-1-5-11";

export function appliesTo(p: gpo.Policy, names: Record<string, string> | undefined): string {
  if (!p.aclKnown) return "filtering unread";
  const name = (sid: string) => names?.[sid.toUpperCase()] ?? sid;
  const allow = (p.applyAllow ?? []).filter((s) => s !== AUTHENTICATED_USERS && s !== "S-1-1-0");
  const everyone = (p.applyAllow ?? []).some((s) => s === AUTHENTICATED_USERS || s === "S-1-1-0");
  const parts: string[] = [];
  if (everyone) parts.push("everyone");
  else if (allow.length) parts.push(allow.map(name).join(", "));
  else parts.push("nobody");
  if (p.applyDeny?.length) parts.push("not " + p.applyDeny.map(name).join(", "));
  return parts.join(", ");
}

export function PoliciesRegister({ isAD }: Props) {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [inv, setInv] = useState<gpo.Inventory | null>(null);
  const [error, setError] = useState("");
  const [oddOnly, setOddOnly] = useState(false);
  const [at, setAt] = useState<number | null>(null);

  async function load() {
    setPhase("loading"); setError("");
    try { setInv(await PolicyInventory()); setPhase("ready"); setAt(Date.now()); }
    catch (e: any) { setError(String(e?.message ?? e)); setPhase("error"); }
  }
  useEffect(() => { if (isAD) load(); }, [isAD]);

  const rows = useMemo(() => {
    const all = (inv?.policies ?? []).map((p) => ({ ...p, links: p.links ?? [] }));
    if (!oddOnly) return all;
    return all.filter((p) => p.links.length === 0 || p.links.some((l) => l.disabled) || p.policy.userDisabled || p.policy.computerDisabled || p.policy.wmiFilter || (p.policy.applyDeny?.length ?? 0) > 0 || !(p.policy.applyAllow ?? []).includes(AUTHENTICATED_USERS));
  }, [inv, oddOnly]);
  const unlinked = (inv?.policies ?? []).filter((p) => (p.links ?? []).length === 0).length;

  function exportCsv() {
    const cols = ["Policy", "GUID", "Linked at", "Enforced", "Disabled links", "User settings", "Computer settings", "WMI filter", "Applies to"];
    const out = rows.map((p) => ({
      Policy: p.policy.name, GUID: p.policy.guid,
      "Linked at": p.links.map((l) => l.somName).join("; "),
      Enforced: p.links.filter((l) => l.enforced).map((l) => l.somName).join("; "),
      "Disabled links": p.links.filter((l) => l.disabled).map((l) => l.somName).join("; "),
      "User settings": p.policy.userDisabled ? "disabled" : "enabled", "Computer settings": p.policy.computerDisabled ? "disabled" : "enabled",
      "WMI filter": p.policy.wmiFilter ? "yes" : "", "Applies to": appliesTo(p.policy, inv?.names),
    }));
    downloadCsv(`adquery-policies-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(cols, out));
  }

  if (!isAD) {
    return (
      <RegisterFrame title="Policies" lede="Every Group Policy Object in the domain, where it is linked and who it is filtered to.">
        <div className="ledger-prose">
          <p><b>This register needs Active Directory.</b></p>
          <p>Group Policy lives in Active Directory: the policy objects under CN=Policies, the gPLink attribute on sites, the domain and organizational units. This directory reports as plain LDAP.</p>
        </div>
      </RegisterFrame>
    );
  }

  const asOf = at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <RegisterFrame
      title="Policies"
      lede={<>Every Group Policy Object in the domain, where it is linked and who it is filtered to, <InlineCheck checked={oddOnly} onChange={setOddOnly} disabled={phase !== "ready"}>only the ones worth a look</InlineCheck>.</>}
      meta={phase === "ready" ? <>
        <span><b>{rows.length.toLocaleString()}</b> policies</span>
        <span>{unlinked} not linked anywhere</span>
        {asOf && <span>as of {asOf} · <button className="ledger-link" onClick={load}>rescan</button></span>}
        <span className="flex-1" />
        <button className="ledger-link" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
      </> : phase === "loading" ? <span>Reading policies and links…</span> : null}
    >
      {phase === "error" && <div className="p-6"><ErrorBanner error={error} /></div>}
      {phase === "ready" && (
        <>
          <table className="ledger-table">
            <thead><tr><th className="is-num">#</th><th>Policy</th><th>Linked at</th><th>Settings</th><th>Applies to</th></tr></thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.policy.dn}>
                  <td className="is-num mono">{i + 1}</td>
                  <td>{p.policy.name} <span className="mono is-dim" title={p.policy.dn}>{p.policy.guid}</span></td>
                  <td className="is-2">
                    {p.links.length === 0 && <span className="ledger-flag warn">not linked</span>}
                    {p.links.map((l, j) => (
                      <span key={l.somDN + j} className="ledger-linkplace" title={l.somDN}>
                        {j > 0 ? ", " : ""}{l.somName}{l.somKind === "site" ? " (site)" : ""}
                        {l.enforced && <span className="ledger-flag"> enforced</span>}
                        {l.disabled && <span className="ledger-flag warn"> link disabled</span>}
                      </span>
                    ))}
                  </td>
                  <td className="is-2">
                    {p.policy.userDisabled && <span className="ledger-flag warn">user half off</span>}
                    {p.policy.computerDisabled && <span className="ledger-flag warn">computer half off</span>}
                    {p.policy.wmiFilter && <span className="ledger-flag warn">wmi filter</span>}
                    {!p.policy.userDisabled && !p.policy.computerDisabled && !p.policy.wmiFilter && <span className="is-dim">both halves</span>}
                  </td>
                  <td className="is-2">{appliesTo(p.policy, inv?.names)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="is-empty">Nothing here needs a look.</td></tr>}
            </tbody>
          </table>
          <p className="ledger-note" style={{ padding: "14px 26px" }}>
            Read from the directory. What a policy sets is in SYSVOL and is not shown; a policy that applies to a user or computer is listed on that row under Policies.
            {inv?.notes?.length ? " " + inv.notes.join(" ") : ""}
          </p>
        </>
      )}
    </RegisterFrame>
  );
}
