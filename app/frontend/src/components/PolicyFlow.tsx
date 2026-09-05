// The flow: policy travelling down the tree to a target. One rule runs from
// the top container to the target; at each station the policies linked
// there sit beside it with their fate. Struck-through names never arrive.
// Blocked inheritance is a dashed rule across the line.
import type { gpo } from "../../wailsjs/go/models";

export function nameSids(text: string, names: Record<string, string> | undefined): string {
  if (!names) return text;
  return text.replace(/S-1-\d+(?:-\d+)+/g, (sid) => names[sid.toUpperCase()] ?? sid);
}

const FATE: Record<string, string> = {
  "link-disabled": "link disabled",
  blocked: "stops at the block",
  denied: "denied",
  filtered: "filtered out",
  "half-disabled": "half disabled",
  "not-found": "policy missing",
  depends: "depends on group",
};

function fateTone(v: string): string {
  if (v === "denied" || v === "not-found") return "is-crit";
  if (v === "applies") return "";
  return "is-warn";
}

interface Props {
  chain: gpo.Chain;
  /** What sits at the bottom of the flow: a person's name, or "4 users, 0 computers". */
  targetLabel: string;
  targetKind: string;
  /** Called when a station is clicked, if the flow lives in the map. */
  onPickStation?: (dn: string) => void;
}

export function PolicyFlow({ chain, targetLabel, targetKind, onPickStation }: Props) {
  const path = chain.path ?? [];
  const entries = chain.entries ?? [];
  const names = chain.names;
  const byStation = new Map<string, gpo.Entry[]>();
  for (const e of entries) {
    const list = byStation.get(e.somDN) ?? [];
    list.push(e);
    byStation.set(e.somDN, list);
  }
  const applying = entries.filter((e) => e.precedence > 0).sort((a, b) => a.precedence - b.precedence);

  // A blocking container stops everything above it that is not enforced;
  // draw the dashed rule just above that station.
  return (
    <div className="ledger-flow-wrap">
      <div className="ledger-flow">
        {path.map((s) => {
          const here = (byStation.get(s.dn) ?? []).slice().sort((a, b) => (a.precedence || 999) - (b.precedence || 999));
          return (
            <div key={s.dn}>
              {s.blockInheritance && (
                <div className="ledger-flow-block">{s.name} blocks inheritance from above. Only enforced links pass.</div>
              )}
              <div className="ledger-flow-stn">
                <div className="ledger-flow-stn-name">
                  {onPickStation
                    ? <button className="ledger-flow-pick" onClick={() => onPickStation(s.dn)} title={s.dn}><span className={s.kind === "domain" ? "mono" : ""}>{s.name}</span></button>
                    : <span className={s.kind === "domain" ? "mono" : ""} title={s.dn}>{s.name}</span>}
                  <small>{s.kind}</small>
                </div>
                {here.length === 0 && <div className="ledger-flow-none">nothing linked here</div>}
                {here.map((e) => {
                  const out = e.precedence === 0;
                  let fate: string;
                  if (e.verdict === "applies") fate = e.enforced && passesBlock(e, path) ? "passes the block, applies" : "applies";
                  else if (e.verdict === "depends") fate = nameSids(e.reason.replace(/^Depends on group membership: /, "").replace(/\.$/, ""), names);
                  else if (e.verdict === "denied") fate = nameSids(e.reason.replace(/^Apply Group Policy is denied to /, "denied to ").replace(/\.$/, ""), names);
                  else fate = FATE[e.verdict] ?? e.verdict;
                  return (
                    <div key={e.policy.dn + e.verdict} className={"ledger-flow-pol" + (out ? " is-out" : "")} title={e.reason ? nameSids(e.reason, names) : undefined}>
                      <span className="ledger-flow-who">
                        {e.policy.name}
                        {e.enforced && <span className="ledger-flag">enforced</span>}
                        {e.wmiUnknown && <span className="ledger-flag warn">wmi unknown</span>}
                      </span>
                      <span className={"ledger-flow-fate " + fateTone(e.verdict)}>
                        {fate}{e.precedence > 0 && <b className="mono"> {e.precedence}</b>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="ledger-flow-stn is-target">
          <div className="ledger-flow-stn-name"><span>{targetLabel}</span><small>{targetKind}</small></div>
        </div>
      </div>
      <div className="ledger-flow-result">
        {applying.length === 0 && <span className="is-dim">Nothing reaches {targetKind === "computer" ? "these computers" : "here"}.</span>}
        {applying.map((e, i) => (
          <span key={e.policy.dn}>{i > 0 && <span className="is-dim"> · </span>}<span className="mono ledger-flow-n">{e.precedence}</span><b>{e.policy.name}</b>{e.verdict === "depends" ? <span className="is-dim">?</span> : null}</span>
        ))}
      </div>
    </div>
  );
}

// An enforced link from above a blocking container has passed a block.
function passesBlock(e: gpo.Entry, path: gpo.SOM[]): boolean {
  const i = path.findIndex((s) => s.dn === e.somDN);
  return path.slice(i + 1).some((s) => s.blockInheritance);
}
