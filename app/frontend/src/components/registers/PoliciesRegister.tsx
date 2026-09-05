// Policies: every Group Policy Object in the domain as a list (where linked,
// which half is off, who it is filtered to) or as a map (the container tree
// with policies pinned to it, and a trace into whichever container is
// picked). Read from the directory; the settings inside a policy are not.
import { useEffect, useMemo, useState } from "react";
import { PolicyInventory, PolicyMap, ContainerChain } from "../../../wailsjs/go/main/App";
import type { gpo } from "../../../wailsjs/go/models";
import { ErrorBanner } from "@/components/ui/error-banner";
import { rowsToCsv } from "../../lib/bulk";
import { downloadCsv } from "../../lib/csv";
import { RegisterFrame, InlineCheck } from "./RegisterFrame";
import { PolicyMapView } from "../PolicyMapView";
import { PolicyFlow } from "../PolicyFlow";

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
  const [view, setView] = useState<"list" | "map">("map");
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
  return view === "map" ? <MapView onList={() => setView("list")} /> : <ListView onMap={() => setView("map")} />;
}

function ViewSwitch({ view, onList, onMap }: { view: "list" | "map"; onList: () => void; onMap: () => void }) {
  return (
    <span className="ledger-view-switch" role="tablist">
      <button role="tab" aria-selected={view === "map"} className={"ledger-tab" + (view === "map" ? " is-on" : "")} onClick={onMap}>Map</button>
      <button role="tab" aria-selected={view === "list"} className={"ledger-tab" + (view === "list" ? " is-on" : "")} onClick={onList}>List</button>
    </span>
  );
}

// ---- Map -------------------------------------------------------------------
function MapView({ onList }: { onList: () => void }) {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [map, setMap] = useState<gpo.Map | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [kind, setKind] = useState<"user" | "computer">("user");
  const [chain, setChain] = useState<gpo.Chain | null>(null);
  const [tracing, setTracing] = useState(false);

  async function load() {
    setPhase("loading"); setError("");
    try {
      const m = await PolicyMap();
      setMap(m); setPhase("ready");
      if (!selected) setSelected((m.nodes ?? []).find((n) => n.kind === "domain")?.dn ?? null);
    } catch (e: any) { setError(String(e?.message ?? e)); setPhase("error"); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return;
    let live = true;
    setTracing(true);
    ContainerChain(selected, kind).then((c) => { if (live) { setChain(c); setTracing(false); } }).catch(() => { if (live) setTracing(false); });
    return () => { live = false; };
  }, [selected, kind]);

  const node = (map?.nodes ?? []).find((n) => n.dn === selected) ?? null;
  const policies = Object.keys(map?.policies ?? {}).length;
  const linkedCount = new Set((map?.nodes ?? []).flatMap((n) => (n.links ?? []).map((l) => l.policyDN.toLowerCase()))).size;

  return (
    <RegisterFrame
      title="Policies"
      lede={<>The containers of the directory with the policies pinned where they are linked. Pick one to trace what flows into it.</>}
      controls={<ViewSwitch view="map" onList={onList} onMap={() => {}} />}
      meta={phase === "ready" ? <>
        <span><b>{policies}</b> policies, {linkedCount} linked somewhere</span>
        <span>{(map?.nodes ?? []).length} containers</span>
        <button className="ledger-link" onClick={load}>rescan</button>
      </> : phase === "loading" ? <span>Reading the tree…</span> : null}
    >
      {phase === "error" && <div className="p-6"><ErrorBanner error={error} /></div>}
      {phase === "ready" && map && (
        <div className="ledger-map-layout">
          <PolicyMapView map={map} selectedDN={selected} onSelect={setSelected} />
          <aside className="ledger-map-side">
            {node ? (
              <>
                <div className="ledger-h4">Flow into {node.name}, for{" "}
                  <button className={"ledger-link" + (kind === "user" ? " is-on" : "")} onClick={() => setKind("user")} style={kind === "user" ? { color: "var(--color-ink)", textDecorationColor: "var(--color-ink)" } : undefined}>users</button>
                  {" · "}
                  <button className="ledger-link" onClick={() => setKind("computer")} style={kind === "computer" ? { color: "var(--color-ink)", textDecorationColor: "var(--color-ink)" } : undefined}>computers</button>
                </div>
                {tracing && !chain && <p className="ledger-note">Tracing…</p>}
                {chain && (
                  <div style={{ opacity: tracing ? 0.6 : 1 }}>
                    <PolicyFlow chain={chain} targetLabel={`${node.users} user${node.users === 1 ? "" : "s"}, ${node.computers} computer${node.computers === 1 ? "" : "s"}`} targetKind={`in ${node.name}`} onPickStation={setSelected} />
                    <p className="ledger-note" style={{ marginTop: 12 }}>{(chain.notes ?? []).join(" ")}</p>
                  </div>
                )}
              </>
            ) : <p className="ledger-note">Pick a container on the map.</p>}
          </aside>
        </div>
      )}
      {phase === "ready" && map?.notes?.length ? <p className="ledger-note" style={{ padding: "0 26px 14px" }}>{map.notes.join(" ")}</p> : null}
    </RegisterFrame>
  );
}

// ---- List ------------------------------------------------------------------
function ListView({ onMap }: { onMap: () => void }) {
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
  useEffect(() => { load(); }, []);

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

  const asOf = at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <RegisterFrame
      title="Policies"
      lede={<>Every Group Policy Object in the domain, where it is linked and who it is filtered to, <InlineCheck checked={oddOnly} onChange={setOddOnly} disabled={phase !== "ready"}>only the ones worth a look</InlineCheck>.</>}
      controls={<ViewSwitch view="list" onList={() => {}} onMap={onMap} />}
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
