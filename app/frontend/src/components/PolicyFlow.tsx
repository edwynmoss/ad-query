// The flow: policy travelling down the tree to a target. One rule runs from
// the top container to the target; at each station the policies linked
// there sit beside it with their fate written as a short sentence. Names
// that never arrive are struck through. Blocked inheritance is a dashed
// rule across the line that only enforced links pass.
//
// With `tryIt`, each line carries quiet controls to try a change in place;
// with `baseline`, the flow marks what would start or stop arriving
// compared with what is real.
import type { gpo } from "../../wailsjs/go/models";

export type Hypothetical = { kind: string; policyDN?: string; containerDN?: string; label: string };

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
export function headline(chain: gpo.Chain, label: string, containerKind?: "user" | "computer", baseline?: gpo.Chain | null): string {
  const entries = chain.entries ?? [];
  const got = entries.filter((e) => e.precedence > 0).length;
  const lost = entries.length - got;
  const subject = containerKind ? `${containerKind === "computer" ? "Computers" : "Users"} in ${label}` : label;
  const pronoun = containerKind ? "them" : chain.targetKind === "computer" ? "it" : "them";
  const n = (k: number) => (k === 0 ? "no policies" : `${k} ${k === 1 ? "policy" : "policies"}`);
  if (baseline) {
    const was = (baseline.entries ?? []).filter((e) => e.precedence > 0).length;
    return was === got ? `${subject} would get the same ${n(got)}, though not always in the same order.` : `${subject} would get ${n(got)} instead of ${n(was)}.`;
  }
  const verb = containerKind ? "get" : "gets";
  let s = `${subject} ${verb} ${n(got)}.`;
  if (lost > 0) s += ` ${lost} more ${lost === 1 ? "is" : "are"} linked above ${pronoun} but never ${lost === 1 ? "arrives" : "arrive"}.`;
  return s;
}

interface Props {
  chain: gpo.Chain;
  targetLabel: string;
  targetKind: string;
  onPickStation?: (dn: string) => void;
  onPickPolicy?: (dn: string) => void;
  /** Offer controls to try a change in place. */
  tryIt?: (h: Hypothetical) => void;
  /** What is real, when `chain` is a hypothetical; lines that change are marked. */
  baseline?: gpo.Chain | null;
}

type Line = { e: gpo.Entry; mark: "" | "starts" | "stops" | "gone" };

export function PolicyFlow({ chain, targetLabel, targetKind, onPickStation, onPickPolicy, tryIt, baseline }: Props) {
  const path = chain.path ?? [];
  const entries = chain.entries ?? [];
  const key = (e: gpo.Entry) => e.policy.dn.toLowerCase() + "|" + e.somDN.toLowerCase();
  const baseBy = new Map<string, gpo.Entry>();
  for (const e of baseline?.entries ?? []) baseBy.set(key(e), e);
  const nowBy = new Map<string, gpo.Entry>();
  for (const e of entries) nowBy.set(key(e), e);

  const byStation = new Map<string, Line[]>();
  const push = (dn: string, l: Line) => { const list = byStation.get(dn) ?? []; list.push(l); byStation.set(dn, list); };
  for (const e of entries) {
    let mark: Line["mark"] = "";
    if (baseline) {
      const b = baseBy.get(key(e));
      const wasIn = !!b && b.precedence > 0, isIn = e.precedence > 0;
      if (isIn && !wasIn) mark = "starts";
      if (!isIn && wasIn) mark = "stops";
    }
    push(e.somDN, { e, mark });
  }
  // Links the hypothetical removed still show, struck, so the change is visible.
  if (baseline) {
    for (const b of baseline.entries ?? []) {
      if (!nowBy.has(key(b))) push(b.somDN, { e: b, mark: "gone" });
    }
  }
  const applying = entries.filter((e) => e.precedence > 0).sort((a, b) => a.precedence - b.precedence);

  return (
    <div className="ledger-flow-wrap">
      <div className="ledger-flow">
        {path.map((s) => {
          const here = (byStation.get(s.dn) ?? []).slice().sort((a, b) => (a.e.precedence || 999) - (b.e.precedence || 999));
          const wasBlocking = baseline ? !!(baseline.path ?? []).find((p) => p.dn === s.dn)?.blockInheritance : s.blockInheritance;
          return (
            <div key={s.dn}>
              {s.blockInheritance && (
                <div className="ledger-flow-block">
                  {s.name} blocks inheritance from above. Only enforced links pass.{baseline && !wasBlocking ? " (would start)" : ""}
                  {tryIt && <button className="ledger-try" onClick={() => tryIt({ kind: "unblock", containerDN: s.dn, label: `${s.name} stops blocking inheritance` })}>try: stop blocking</button>}
                </div>
              )}
              {!s.blockInheritance && baseline && wasBlocking && (
                <div className="ledger-flow-block is-gone">{s.name} would no longer block inheritance.</div>
              )}
              <div className="ledger-flow-stn">
                <div className="ledger-flow-stn-name">
                  {onPickStation
                    ? <button className="ledger-flow-pick" onClick={() => onPickStation(s.dn)} title={s.dn}><span className={s.kind === "domain" ? "mono" : ""}>{s.name}</span></button>
                    : <span className={s.kind === "domain" ? "mono" : ""} title={s.dn}>{s.name}</span>}
                  <small>{s.kind === "ou" ? "organizational unit" : s.kind}</small>
                  {tryIt && s.kind === "ou" && !s.blockInheritance && <button className="ledger-try" onClick={() => tryIt({ kind: "block", containerDN: s.dn, label: `${s.name} blocks inheritance from above` })}>try: block inheritance</button>}
                </div>
                {here.length === 0 && <div className="ledger-flow-none">nothing linked here</div>}
                {here.map(({ e, mark }) => {
                  const out = e.precedence === 0 || mark === "gone";
                  const fate = mark === "gone" ? { text: "would be gone from here", tone: "warn" as const } : fateOf(e, chain);
                  return (
                    <div key={key(e) + mark} className={"ledger-flow-pol" + (out ? " is-out" : "") + (mark ? " is-" + mark : "")} title={e.policy.dn}>
                      <span className="ledger-flow-who">
                        {onPickPolicy && e.verdict !== "not-found"
                          ? <button className="ledger-flow-pick" onClick={() => onPickPolicy(e.policy.dn)}>{e.policy.name}</button>
                          : e.policy.name}
                        {tryIt && mark !== "gone" && e.verdict !== "not-found" && (
                          <span className="ledger-try-group">
                            <button className="ledger-try" onClick={() => tryIt({ kind: "unlink", policyDN: e.policy.dn, containerDN: e.somDN, label: `${e.policy.name} unlinked from ${e.somName}` })}>unlink</button>
                            {e.enforced
                              ? <button className="ledger-try" onClick={() => tryIt({ kind: "unenforce", policyDN: e.policy.dn, containerDN: e.somDN, label: `${e.policy.name} no longer enforced on ${e.somName}` })}>stop enforcing</button>
                              : <button className="ledger-try" onClick={() => tryIt({ kind: "enforce", policyDN: e.policy.dn, containerDN: e.somDN, label: `${e.policy.name} enforced on ${e.somName}` })}>enforce</button>}
                            <button className="ledger-try" onClick={() => tryIt({ kind: "policy-off", policyDN: e.policy.dn, label: `${e.policy.name} switched off` })}>switch off</button>
                          </span>
                        )}
                      </span>
                      <span className={"ledger-flow-fate" + (fate.tone ? " is-" + fate.tone : "")}>
                        {mark === "starts" && <b className="ledger-mark is-start">would start arriving · </b>}
                        {mark === "stops" && <b className="ledger-mark is-stop">would stop · </b>}
                        {fate.text}{e.precedence > 0 && mark !== "gone" && <b className="mono"> {e.precedence}{e.verdict === "depends" ? "?" : ""}</b>}
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
          ? <span className="is-dim">{baseline ? "Nothing would arrive." : "Nothing arrives."}</span>
          : <>
              <span className="is-dim">{baseline ? "Would arrive, strongest first: " : "Arrives, strongest first: "}</span>
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
      <p><b>Trying a change</b> applies it to a copy in memory and redraws. Nothing is written to the directory.</p>
      <p><b>What this cannot see.</b> Loopback and slow-link processing happen on the client, and the settings inside each policy live in SYSVOL, not the directory.{chain?.notes?.length ? " " + chain.notes.filter((n) => !/^Read from the directory only/.test(n)).join(" ") : ""}</p>
    </details>
  );
}
