// "What if": one hypothetical change to Group Policy, applied in memory by
// the backend, answered as a sentence and then container by container.
// Nothing is written to the directory.
import { useEffect, useState } from "react";
import { WhatIf } from "../../wailsjs/go/main/App";
import { gpo } from "../../wailsjs/go/models";
import { ErrorBanner } from "@/components/ui/error-banner";

export type Hypothetical = { kind: string; policyDN?: string; containerDN?: string; label: string };

interface Props {
  options: Hypothetical[];
  onTrace?: (containerDN: string) => void;
}

function count(e: gpo.Effect, kind: "users" | "computers"): string {
  const n = kind === "users" ? e.users : e.computers;
  if (n < 0) return "";
  return `${n.toLocaleString()} ${kind === "users" ? (n === 1 ? "user" : "users") : (n === 1 ? "computer" : "computers")}`;
}

/** The headline: who is affected, in one sentence. */
function summary(w: gpo.WhatIf): string {
  const roots = (list: gpo.Effect[]) => list.filter((e) => e.root);
  const u = roots(w.users ?? []), c = roots(w.computers ?? []);
  const sum = (list: gpo.Effect[]) => list.reduce((n, e) => n + Math.max(0, e.users >= 0 ? e.users : 0), 0);
  const sumC = (list: gpo.Effect[]) => list.reduce((n, e) => n + Math.max(0, e.computers >= 0 ? e.computers : 0), 0);
  if (u.length === 0 && c.length === 0) return "Nothing would change. No container gains or loses a policy.";
  // Name the accounts that exist; a half with nobody under it stays quiet.
  const parts: string[] = [];
  const uKnown = u.every((e) => e.users >= 0), cKnown = c.every((e) => e.computers >= 0);
  if (u.length && (!uKnown || sum(u) > 0)) parts.push(`${uKnown ? sum(u).toLocaleString() + " " : ""}users under ${u.length === 1 ? u[0].name : `${u.length} containers`}`);
  if (c.length && (!cKnown || sumC(c) > 0)) parts.push(`${cKnown ? sumC(c).toLocaleString() + " " : ""}computers under ${c.length === 1 ? c[0].name : `${c.length} containers`}`);
  if (parts.length === 0) return `No accounts sit under the affected ${u.length + c.length === 1 ? "container" : "containers"} today, so nobody would notice, but the containers would ${describeVerbs(w)}.`;
  return `${parts.join(" and ")} would ${describeVerbs(w)}.`;
}

function describeVerbs(w: gpo.WhatIf): string {
  const loses = new Set<string>(), gains = new Set<string>();
  for (const e of [...(w.users ?? []), ...(w.computers ?? [])]) { e.loses?.forEach((p) => loses.add(p)); e.gains?.forEach((p) => gains.add(p)); }
  const verbs: string[] = [];
  if (loses.size) verbs.push(`lose ${[...loses].join(", ")}`);
  if (gains.size) verbs.push(`gain ${[...gains].join(", ")}`);
  if (verbs.length === 0) verbs.push("keep the same policies in a different order");
  return verbs.join(" and ");
}

export function WhatIfPanel({ options, onTrace }: Props) {
  const [pick, setPick] = useState<Hypothetical | null>(null);
  const [result, setResult] = useState<gpo.WhatIf | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!pick) return;
    let live = true;
    setBusy(true); setError(""); setResult(null);
    WhatIf(gpo.Change.createFrom({ kind: pick.kind, policyDN: pick.policyDN ?? "", containerDN: pick.containerDN ?? "" }))
      .then((w) => { if (live) { setResult(w); setBusy(false); } })
      .catch((e: any) => { if (live) { setError(String(e?.message ?? e)); setBusy(false); } });
    return () => { live = false; };
  }, [pick]);

  const effects = (list: gpo.Effect[], kind: "users" | "computers") => (
    <div className="ledger-lines">
      {list.map((e) => (
        <div key={e.containerDN} className={"ledger-line is-static" + (e.root ? "" : " is-sub")}>
          <span className="ledger-line-text">
            {onTrace ? <button className="ledger-flow-pick" onClick={() => onTrace(e.containerDN)} title={e.containerDN}>{e.name}</button> : <span title={e.containerDN}>{e.name}</span>}
            {e.root && count(e, kind) && <small className="ledger-kind">{count(e, kind)} under it</small>}
          </span>
          <span className="ledger-line-desc">
            {e.loses?.length ? <>loses {e.loses.join(", ")}</> : null}
            {e.loses?.length && e.gains?.length ? "; " : null}
            {e.gains?.length ? <>gains {e.gains.join(", ")}</> : null}
            {!e.loses?.length && !e.gains?.length && e.reordered?.length ? <>same policies, new order: {e.reordered.join(" › ")}</> : null}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="ledger-whatif">
      <div className="ledger-h4">What if</div>
      <div className="ledger-whatif-options">
        {options.map((o) => (
          <button key={o.kind + (o.policyDN ?? "") + (o.containerDN ?? "")} className={"ledger-whatif-opt" + (pick === o ? " is-on" : "")} onClick={() => setPick(o)}>{o.label}</button>
        ))}
      </div>
      {busy && <p className="ledger-note">Working it out…</p>}
      {error && <ErrorBanner error={error} />}
      {result && !busy && (
        <div className="ledger-whatif-result">
          <p className="ledger-headline">{summary(result)}</p>
          {(result.users?.length ?? 0) > 0 && <><div className="ledger-h4">For users</div>{effects(result.users, "users")}</>}
          {(result.computers?.length ?? 0) > 0 && <><div className="ledger-h4">For computers</div>{effects(result.computers, "computers")}</>}
          <p className="ledger-note">{(result.notes ?? []).join(" ")}</p>
        </div>
      )}
    </div>
  );
}
