// The flow: policy travelling down the tree to a target. One rule runs from
// the top container to the target; at each station the policies linked
// there sit beside it with their fate written as a short sentence. Names
// that never arrive are struck through. Blocked inheritance is a dashed
// rule across the line that only enforced links pass.
import type { gpo } from "../../wailsjs/go/models";

export function nameSids(text: string, names: Record<string, string> | undefined): string {
  if (!names) return text;
  return text.replace(/S-1-\d+(?:-\d+)+/g, (sid) => names[sid.toUpperCase()] ?? sid);
}

function listNames(sids: string[] | undefined, names: Record<string, string> | undefined): string {
  return (sids ?? []).map((s) => names?.[s.toUpperCase()] ?? s).join(", ");
}

/** The fate of one link, as a sentence fragment that follows the policy name. */
export function fateOf(e: gpo.Entry, chain: gpo.Chain): { text: string; tone: "" | "warn" | "crit" } {
  const path = chain.path ?? [];
  const names = chain.names;
  const kind = chain.targetKind === "computer" ? "computer" : "user";
  switch (e.verdict) {
    case "applies": {
      const passes = e.enforced && passesBlock(e, path);
      let t = passes ? "enforced, so it passes the block and applies" : e.enforced ? "enforced, applies" : "applies";
      if (e.wmiUnknown) t += e.policy.wmiFilterName ? ` if its WMI filter “${e.policy.wmiFilterName}” passes` : " if its WMI filter passes";
      if (!e.policy.aclKnown) t += " (filtering unread)";
      return { text: t, tone: e.wmiUnknown ? "warn" : "" };
    }
    case "depends": {
      const parts: string[] = [];
      const only = e.reason.match(/applies only to ([^;.]+)/);
      const not = e.reason.match(/denied to ([^;.]+)/);
      if (only) parts.push("only for " + nameSids(only[1], names));
      if (not) parts.push("not for " + nameSids(not[1], names));
      return { text: parts.join(", ") || "depends on group membership", tone: "warn" };
    }
    case "denied": {
      const who = e.reason.replace(/^Apply Group Policy is denied to /, "").replace(/\.$/, "");
      return { text: `would apply, but ${nameSids(who, names)} is denied it`, tone: "crit" };
    }
    case "filtered": {
      const allow = listNames(e.policy.applyAllow, names);
      return { text: allow ? `only for ${allow}, which does not include this ${kind}` : "nobody holds Apply Group Policy on it", tone: "warn" };
    }
    case "link-disabled":
      return { text: `the link is switched off on ${e.somName}`, tone: "warn" };
    case "blocked": {
      const blocker = blockerBelow(e, path);
      return { text: blocker ? `stops at ${blocker}'s block` : "stops at a block", tone: "warn" };
    }
    case "half-disabled":
      return { text: `its ${kind} settings are switched off`, tone: "warn" };
    case "not-found":
      return { text: "the policy no longer exists", tone: "crit" };
    default:
      return { text: e.verdict, tone: "warn" };
  }
}

function passesBlock(e: gpo.Entry, path: gpo.SOM[]): boolean {
  const i = path.findIndex((s) => s.dn === e.somDN);
  return i >= 0 && path.slice(i + 1).some((s) => s.blockInheritance);
}

function blockerBelow(e: gpo.Entry, path: gpo.SOM[]): string {
  const i = path.findIndex((s) => s.dn === e.somDN);
  return path.slice(i + 1).find((s) => s.blockInheritance)?.name ?? "";
}

/** "Terry Wong gets 5 policies. 2 more are linked above them but never arrive." */
export function headline(chain: gpo.Chain, label: string, containerKind?: "user" | "computer"): string {
  const entries = chain.entries ?? [];
  const got = entries.filter((e) => e.precedence > 0).length;
  const lost = entries.length - got;
  const subject = containerKind ? `${containerKind === "computer" ? "Computers" : "Users"} in ${label}` : label;
  const verb = containerKind ? "get" : "gets";
  const pronoun = containerKind ? "them" : chain.targetKind === "computer" ? "it" : "them";
  let s = `${subject} ${verb} ${got === 0 ? "no policies" : `${got} ${got === 1 ? "policy" : "policies"}`}.`;
  if (lost > 0) s += ` ${lost} more ${lost === 1 ? "is" : "are"} linked above ${pronoun} but never ${lost === 1 ? "arrives" : "arrive"}.`;
  return s;
}

interface Props {
  chain: gpo.Chain;
  targetLabel: string;
  targetKind: string;
  onPickStation?: (dn: string) => void;
  onPickPolicy?: (dn: string) => void;
}

export function PolicyFlow({ chain, targetLabel, targetKind, onPickStation, onPickPolicy }: Props) {
  const path = chain.path ?? [];
  const entries = chain.entries ?? [];
  const byStation = new Map<string, gpo.Entry[]>();
  for (const e of entries) {
    const list = byStation.get(e.somDN) ?? [];
    list.push(e);
    byStation.set(e.somDN, list);
  }
  const applying = entries.filter((e) => e.precedence > 0).sort((a, b) => a.precedence - b.precedence);

  return (
    <div className="ledger-flow-wrap">
      <div className="ledger-flow">
        {path.map((s) => {
          const here = (byStation.get(s.dn) ?? []).slice().sort((a, b) => (a.precedence || 999) - (b.precedence || 999));
          return (
            <div key={s.dn}>
              {s.blockInheritance && <div className="ledger-flow-block">{s.name} blocks inheritance from above. Only enforced links pass.</div>}
              <div className="ledger-flow-stn">
                <div className="ledger-flow-stn-name">
                  {onPickStation
                    ? <button className="ledger-flow-pick" onClick={() => onPickStation(s.dn)} title={s.dn}><span className={s.kind === "domain" ? "mono" : ""}>{s.name}</span></button>
                    : <span className={s.kind === "domain" ? "mono" : ""} title={s.dn}>{s.name}</span>}
                  <small>{s.kind === "ou" ? "organizational unit" : s.kind}</small>
                </div>
                {here.length === 0 && <div className="ledger-flow-none">nothing linked here</div>}
                {here.map((e) => {
                  const out = e.precedence === 0;
                  const fate = fateOf(e, chain);
                  return (
                    <div key={e.policy.dn + e.verdict} className={"ledger-flow-pol" + (out ? " is-out" : "")} title={e.policy.dn}>
                      <span className="ledger-flow-who">{onPickPolicy && e.verdict !== "not-found"
                        ? <button className="ledger-flow-pick" onClick={() => onPickPolicy(e.policy.dn)}>{e.policy.name}</button>
                        : e.policy.name}</span>
                      <span className={"ledger-flow-fate" + (fate.tone ? " is-" + fate.tone : "")}>
                        {fate.text}{e.precedence > 0 && <b className="mono"> {e.precedence}{e.verdict === "depends" ? "?" : ""}</b>}
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
        {applying.length === 0
          ? <span className="is-dim">Nothing arrives.</span>
          : <>
              <span className="is-dim">Arrives, strongest first: </span>
              {applying.map((e, i) => (
                <span key={e.policy.dn}>{i > 0 && <span className="is-dim"> · </span>}<span className="mono ledger-flow-n">{e.precedence}</span><b>{e.policy.name}</b>{e.verdict === "depends" ? <span className="is-dim" title="Depends on group membership">?</span> : null}</span>
              ))}
            </>}
      </div>
    </div>
  );
}

/** The fold-out that explains the rules in ordinary words. */
export function PolicyExplainer({ chain }: { chain?: gpo.Chain | null }) {
  return (
    <details className="ledger-explain">
      <summary>How this is worked out</summary>
      <p><b>The order.</b> When two policies set the same thing, the one nearer the top of the list wins. Nearer containers beat farther ones; within one container the first-listed link wins.</p>
      <p><b>Enforced.</b> An enforced link beats every non-enforced one below it and passes through any block. Between enforced links, the farther container wins.</p>
      <p><b>Blocking inheritance.</b> A container can refuse everything linked above it. Only enforced links get through.</p>
      <p><b>Filtering.</b> A policy applies only to accounts allowed to read it and apply it. Deny beats allow. This is decided by group membership, which is why a person's trace can differ from their container's.</p>
      <p><b>Switched-off halves.</b> A policy can have its user settings or its computer settings turned off. It then does nothing for that kind of account.</p>
      <p><b>WMI filters</b> are a test the computer runs on itself. The directory cannot run it, so those policies are shown as applying if the filter passes.</p>
      <p><b>What this cannot see.</b> Loopback and slow-link processing happen on the client, and the settings inside each policy live in SYSVOL, not the directory.{chain?.notes?.length ? " " + chain.notes.filter((n) => !/^Read from the directory only/.test(n)).join(" ") : ""}</p>
    </details>
  );
}
