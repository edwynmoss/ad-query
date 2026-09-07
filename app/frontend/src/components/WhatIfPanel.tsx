// The pieces of a hypothetical: the line at the top that says what is being
// tried, and the container-by-container impact that answers "and who else".
// The backend applies the changes to a copy; nothing is written.
import { useEffect, useState } from "react";
import { WhatIf, CountUnder } from "../../wailsjs/go/main/App";
import { gpo, type main } from "../../wailsjs/go/models";
import { ErrorBanner } from "@/components/ui/error-banner";
import type { Hypothetical } from "./PolicyFlow";

export type { Hypothetical } from "./PolicyFlow";

export function toChanges(hs: Hypothetical[]): gpo.Change[] {
  return hs.map((h) => gpo.Change.createFrom({ kind: h.kind, policyDN: h.policyDN ?? "", containerDN: h.containerDN ?? "", groupSID: h.groupSID ?? "", label: h.label }));
}

/** The line at the top of a page while a hypothetical is on. */
export function HypotheticalBar({ changes, onRemove, onReset }: { changes: Hypothetical[]; onRemove: (i: number) => void; onReset: () => void }) {
  if (changes.length === 0) return null;
  return (
    <div className="ledger-hypo" role="status">
      <span className="ledger-hypo-word">Hypothetical</span>
      {changes.map((c, i) => (
        <span key={i} className="ledger-hypo-item">{i > 0 && <span className="is-dim"> and </span>}{c.label}<button className="ledger-hypo-x" onClick={() => onRemove(i)} aria-label={`drop ${c.label}`}>×</button></span>
      ))}
      <span className="flex-1" />
      <button className="ledger-link" onClick={onReset}>Back to what is real</button>
    </div>
  );
}

function count(e: gpo.Effect, kind: "users" | "computers"): string {
  const n = kind === "users" ? e.users : e.computers;
  if (n < 0) return "";
  return `${n.toLocaleString()} ${kind === "users" ? (n === 1 ? "user" : "users") : (n === 1 ? "computer" : "computers")}`;
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

/** Who is affected, in one sentence. */
export function impactSummary(w: gpo.WhatIf): string {
  const roots = (list: gpo.Effect[]) => list.filter((e) => e.root);
  const u = roots(w.users ?? []), c = roots(w.computers ?? []);
  const sum = (list: gpo.Effect[]) => list.reduce((n, e) => n + (e.users >= 0 ? e.users : 0), 0);
  const sumC = (list: gpo.Effect[]) => list.reduce((n, e) => n + (e.computers >= 0 ? e.computers : 0), 0);
  if (u.length === 0 && c.length === 0) return "Nobody else is affected. No container gains or loses a policy.";
  const parts: string[] = [];
  const uKnown = u.every((e) => e.users >= 0), cKnown = c.every((e) => e.computers >= 0);
  if (u.length && (!uKnown || sum(u) > 0)) parts.push(`${uKnown ? sum(u).toLocaleString() + " " : ""}users under ${u.length === 1 ? u[0].name : `${u.length} containers`}`);
  if (c.length && (!cKnown || sumC(c) > 0)) parts.push(`${cKnown ? sumC(c).toLocaleString() + " " : ""}computers under ${c.length === 1 ? c[0].name : `${c.length} containers`}`);
  if (parts.length === 0) return `No accounts sit under the affected ${u.length + c.length === 1 ? "container" : "containers"} today, so nobody would notice, but the containers would ${describeVerbs(w)}.`;
  return `${parts.join(" and ")} would ${describeVerbs(w)}.`;
}

/** A half is worth listing unless every impact root is known to hold no accounts of that kind. */
function worth(list: gpo.Effect[], kind: "users" | "computers"): boolean {
  if (list.length === 0) return false;
  const roots = list.filter((e) => e.root);
  return roots.some((e) => (kind === "users" ? e.users : e.computers) !== 0);
}

/** The container-by-container impact of a set of changes. */
export function ImpactList({ changes, onTrace, title }: { changes: Hypothetical[]; onTrace?: (containerDN: string) => void; title?: string }) {
  const [result, setResult] = useState<gpo.WhatIf | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // How many accounts sit under each affected container, by DN. These arrive
  // after the answer does: the directory has to hand over every object under
  // a container to be counted, which on a large domain takes far longer than
  // working out what changes. The list is useful without them.
  const [counted, setCounted] = useState<Record<string, main.Counts>>({});
  const sig = JSON.stringify(changes);

  useEffect(() => {
    if (changes.length === 0) { setResult(null); setCounted({}); return; }
    let live = true;
    setBusy(true); setError(""); setCounted({});
    WhatIf(toChanges(changes))
      .then((w) => {
        if (!live) return;
        setResult(w); setBusy(false);
        // Count the containers where the impact starts, one at a time so a
        // big subtree does not hold the connection against everything else.
        const roots: string[] = [];
        for (const e of [...(w.users ?? []), ...(w.computers ?? [])]) {
          if (e.root && !roots.includes(e.containerDN)) roots.push(e.containerDN);
        }
        void (async () => {
          for (const dn of roots.slice(0, 12)) {
            if (!live) return;
            try {
              const c = await CountUnder(dn);
              if (live) setCounted((was) => ({ ...was, [dn]: c }));
            } catch { /* a count that fails just stays unknown */ }
          }
        })();
      })
      .catch((e: any) => { if (live) { setError(String(e?.message ?? e)); setBusy(false); } });
    return () => { live = false; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  // The effects as they came back, with any counts that have since arrived.
  const withCounts = (list: gpo.Effect[]): gpo.Effect[] =>
    list.map((e) => {
      const c = counted[e.containerDN];
      return c ? ({ ...e, users: c.users, computers: c.computers } as gpo.Effect) : e;
    });

  if (changes.length === 0) return null;

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
    <div className="ledger-impact">
      <div className="ledger-h4">{title ?? "And who else"}</div>
      {busy && <p className="ledger-note">Working it out…</p>}
      {error && <ErrorBanner error={error} />}
      {result && !busy && (
        <>
          <p className="ledger-headline">{impactSummary({ ...result, users: withCounts(result.users ?? []), computers: withCounts(result.computers ?? []) } as gpo.WhatIf)}</p>
          {worth(withCounts(result.users ?? []), "users") && <><div className="ledger-h4">For users</div>{effects(withCounts(result.users ?? []), "users")}</>}
          {worth(withCounts(result.computers ?? []), "computers") && <><div className="ledger-h4">For computers</div>{effects(withCounts(result.computers ?? []), "computers")}</>}
          <p className="ledger-note">{(result.notes ?? []).join(" ")}</p>
        </>
      )}
    </div>
  );
}
