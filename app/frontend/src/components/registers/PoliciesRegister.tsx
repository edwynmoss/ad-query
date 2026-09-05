// Policies: which Group Policy Objects reach a person, a computer or a
// container, and why. Opens on the question; the answer is a page with one
// sentence, the flow, and the rules on request. From anywhere, a policy
// name opens the policy's own page, a container opens its trace or the
// people in it, and a person opens their row in Search.
import { useEffect, useMemo, useRef, useState } from "react";
import { PolicyInventory, PolicyMap, PolicyChainWith, ContainerChainWith, CountUnder, Search } from "../../../wailsjs/go/main/App";
import { ldap, type gpo, type main } from "../../../wailsjs/go/models";
import { ErrorBanner } from "@/components/ui/error-banner";
import { toast } from "sonner";
import type { QueryState } from "../QueryBar";
import { rowsToCsv } from "../../lib/bulk";
import { downloadCsv } from "../../lib/csv";
import { escapeLdapValue, newCondition } from "../../lib/filterBuilder";
import { OBJECT_TYPES, filterFor, defaultAttributesFor } from "../../lib/objectTypes";
import { RegisterFrame, InlineCheck } from "./RegisterFrame";
import { PolicyMapView } from "../PolicyMapView";
import { PolicyFlow, PolicyExplainer, headline, fateOf, traceAsText, changedRecently, daysSince, type ContainerHit } from "../PolicyFlow";
import { HypotheticalBar, ImpactList, toChanges, type Hypothetical } from "../WhatIfPanel";

export type Target = { dn: string; kind: "user" | "computer" | "container"; label: string };
export type PolicyPage = { name: "home" } | { name: "trace"; target: Target } | { name: "map"; reveal?: string } | { name: "list" } | { name: "policy"; dn: string };

interface Props {
  isAD: boolean;
  /** The domain root: this register always searches the whole domain, wherever Search is pointed. */
  baseDN: string;
  /** A page to open, set from elsewhere (a row's "Open as a page"). */
  start?: { page: PolicyPage; nonce: number } | null;
  onOpenQuery: (q: QueryState) => void;
}

const AUTHENTICATED_USERS = "S-1-5-11";
const USERS = OBJECT_TYPES.find((t) => t.key === "users") ?? OBJECT_TYPES[0];

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

/** The people in a container, as a Search query. */
export function peopleIn(containerDN: string): QueryState {
  return { baseDN: containerDN, scope: 2, filter: filterFor(USERS, true), attributes: defaultAttributesFor(USERS, true), conditions: [], matchOp: "and", search: "" };
}

/** One account's row, as a Search query. */
export function rowOf(dn: string, root: string): QueryState {
  const c = { ...newCondition(), attribute: "distinguishedName", operator: "eq" as const, value: dn };
  return { baseDN: root, scope: 2, filter: "(objectClass=*)", attributes: defaultAttributesFor(USERS, true), conditions: [c], matchOp: "and", search: "" };
}

export function PoliciesRegister({ isAD, baseDN, start, onOpenQuery }: Props) {
  const [page, setPage] = useState<PolicyPage>({ name: "home" });
  useEffect(() => { if (start) setPage(start.page); }, [start]);
  if (!isAD) {
    return (
      <RegisterFrame title="Policies" lede="Which Group Policy Objects reach a person, a computer or a container, and why.">
        <div className="ledger-prose">
          <p><b>This register needs Active Directory.</b></p>
          <p>Group Policy lives in Active Directory: the policy objects under CN=Policies, the gPLink attribute on sites, the domain and organizational units. This directory reports as plain LDAP.</p>
        </div>
      </RegisterFrame>
    );
  }
  const go = (p: PolicyPage) => setPage(p);
  const nav = {
    onBack: () => go({ name: "home" }),
    onTrace: (t: Target) => go({ name: "trace", target: t }),
    onPolicy: (dn: string) => go({ name: "policy", dn }),
    onMap: (reveal?: string) => go({ name: "map", reveal }),
    onPeople: (containerDN: string) => onOpenQuery(peopleIn(containerDN)),
    onRow: (dn: string) => onOpenQuery(rowOf(dn, baseDN)),
  };
  switch (page.name) {
    case "trace": return <TracePage target={page.target} {...nav} />;
    case "map": return <MapPage reveal={page.reveal} {...nav} />;
    case "list": return <ListPage {...nav} />;
    case "policy": return <PolicyDetailPage dn={page.dn} {...nav} />;
    default: return <HomePage baseDN={baseDN} onTrace={nav.onTrace} onMap={() => nav.onMap()} onList={() => go({ name: "list" })} />;
  }
}

type Nav = { onBack: () => void; onTrace: (t: Target) => void; onPolicy: (dn: string) => void; onMap: (reveal?: string) => void; onPeople: (dn: string) => void; onRow: (dn: string) => void };

const containerTarget = (dn: string): Target => ({ dn, kind: "container", label: dn.split(",")[0].replace(/^[^=]+=/, "") });

/** The policies one chain receives and the other does not, by lower-case DN. */
function onlyFor(mine: gpo.Chain | null, theirs: gpo.Chain | null): Set<string> {
  const out = new Set<string>();
  if (!mine || !theirs) return out;
  const other = new Set((theirs.entries ?? []).filter((e) => e.precedence > 0).map((e) => e.policy.dn.toLowerCase()));
  for (const e of mine.entries ?? []) {
    if (e.precedence > 0 && !other.has(e.policy.dn.toLowerCase())) out.add(e.policy.dn.toLowerCase());
  }
  return out;
}

/** "Both get 3 policies. Terry Wong also gets Sales Drive Maps." */
function compareSentence(a: gpo.Chain, b: gpo.Chain, aName: string, bName: string): string {
  const onlyA = [...onlyFor(a, b)], onlyB = [...onlyFor(b, a)];
  const nameOf = (c: gpo.Chain, dn: string) => (c.entries ?? []).find((e) => e.policy.dn.toLowerCase() === dn)?.policy.name ?? dn;
  const shared = (a.entries ?? []).filter((e) => e.precedence > 0).length - onlyA.length;
  const bits = [`${aName} and ${bName} share ${shared === 0 ? "no policies" : `${shared} ${shared === 1 ? "policy" : "policies"}`}.`];
  if (onlyA.length) bits.push(`${aName} also gets ${onlyA.map((d) => nameOf(a, d)).join(", ")}.`);
  if (onlyB.length) bits.push(`${bName} also gets ${onlyB.map((d) => nameOf(b, d)).join(", ")}.`);
  if (!onlyA.length && !onlyB.length) bits.push("They receive exactly the same policies.");
  return bits.join(" ");
}

/** "5 policies" for a chain, for the paired sentence. */
function countOf(c: gpo.Chain): string {
  const n = (c.entries ?? []).filter((e) => e.precedence > 0).length;
  return n === 0 ? "no policies" : `${n} ${n === 1 ? "policy" : "policies"}`;
}

/** A link that opens an inline find and hands back what was picked. */
function PickerLink({ label, word, placeholder, find, onPick }: { label: string; word: string; placeholder: string; find: (q: string) => Promise<Target[]>; onPick: (t: Target) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Target[]>([]);
  const search = async (v: string) => {
    setQ(v);
    if (v.trim().length < 2) { setHits([]); return; }
    try { setHits(await find(v)); } catch { setHits([]); }
  };
  const close = () => { setOpen(false); setQ(""); setHits([]); };
  if (!open) return <button className="ledger-link" onClick={() => setOpen(true)}>{label}</button>;
  return (
    <span className="ledger-move">
      <span className="ledger-controls-word">{word}</span>
      <input className="ledger-inline-input" autoFocus value={q} onChange={(e) => search(e.target.value)} placeholder={placeholder} aria-label={label} />
      {hits.map((h) => <button key={h.dn} className="ledger-link" title={h.dn} onClick={() => { close(); onPick(h); }}>{h.label}</button>)}
      {q.trim().length >= 2 && hits.length === 0 && <span className="is-dim">nothing by that name</span>}
      <button className="ledger-link" onClick={close}>cancel</button>
    </span>
  );
}

// ---- Home: the question ------------------------------------------------------
function HomePage({ baseDN, onTrace, onMap, onList }: { baseDN: string; onTrace: (t: Target) => void; onMap: () => void; onList: () => void }) {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Target[]>([]);
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) { setHits([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const v = escapeLdapValue(q);
        const res = await Search(ldap.SearchRequest.createFrom({
          baseDN, scope: 2, pageSize: 40, sizeLimit: 40,
          filter: `(|(&(objectCategory=person)(objectClass=user)(anr=${v}))(&(objectCategory=computer)(anr=${v}))(&(objectClass=organizationalUnit)(ou=*${v}*)))`,
          attributes: ["displayName", "sAMAccountName", "dNSHostName", "ou", "objectClass", "name"],
        }));
        if (!live) return;
        const out: Target[] = (res.entries ?? []).map((e) => {
          const a = e.attributes ?? {};
          const classes = (a.objectClass ?? []).map((c) => c.toLowerCase());
          if (classes.includes("organizationalunit")) return { dn: e.dn, kind: "container" as const, label: a.ou?.[0] || a.name?.[0] || e.dn };
          if (classes.includes("computer")) return { dn: e.dn, kind: "computer" as const, label: a.name?.[0] || a.dNSHostName?.[0] || e.dn };
          return { dn: e.dn, kind: "user" as const, label: a.displayName?.[0] || a.sAMAccountName?.[0] || a.name?.[0] || e.dn };
        });
        const order = { user: 0, computer: 1, container: 2 };
        out.sort((x, y) => order[x.kind] - order[y.kind] || x.label.localeCompare(y.label));
        setHits(out);
      } catch { if (live) setHits([]); }
      finally { if (live) setSearching(false); }
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [term, baseDN]);

  const where = (dn: string) => dn.split(",").filter((p) => /^ou=/i.test(p)).map((p) => p.replace(/^ou=/i, "")).join(" › ") || "domain root";
  const groups: Array<[string, Target[]]> = [["People", hits.filter((h) => h.kind === "user")], ["Computers", hits.filter((h) => h.kind === "computer")], ["Containers", hits.filter((h) => h.kind === "container")]];

  return (
    <RegisterFrame title="Policies" lede="Which Group Policy Objects reach a person, a computer or a container, and why.">
      <div className="ledger-open" style={{ paddingTop: 22 }}>
        <div className="ledger-eyebrow">Trace policy to</div>
        <div className="ledger-rule-field is-large">
          <input ref={input} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="A person, a computer or a container" aria-label="Trace policy to"
            onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) onTrace(hits[0]); }} />
          <span className="ledger-rule-hint mono">{searching ? "searching…" : hits.length ? "Enter for the first" : "type a name"}</span>
        </div>
        {hits.length > 0 && (
          <div className="ledger-lines" style={{ marginTop: 10 }}>
            {groups.filter(([, list]) => list.length).map(([title, list]) => (
              <div key={title}>
                <div className="ledger-h4" style={{ marginTop: 14 }}>{title}</div>
                {list.map((h) => (
                  <button key={h.dn} className="ledger-line" onClick={() => onTrace(h)} title={h.dn}>
                    <span className="ledger-line-text">{h.label}</span>
                    <span className="ledger-line-meta">{where(h.dn)}</span>
                    <span className="mono ledger-line-meta">{h.kind === "container" ? "organizational unit" : h.kind}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        {term.trim().length >= 2 && !searching && hits.length === 0 && <p className="ledger-note" style={{ marginTop: 10 }}>Nothing by that name. Try a first name, a username or a computer name.</p>}

        <div className="ledger-h4">Or</div>
        <div className="ledger-lines">
          <button className="ledger-line is-register" onClick={onMap}>
            <span className="ledger-line-name">Browse the tree</span>
            <span className="ledger-line-desc">The containers of the domain with policies pinned where they are linked. Branches with nothing linked stay folded.</span>
            <span />
          </button>
          <button className="ledger-line is-register" onClick={onList}>
            <span className="ledger-line-name">All policies</span>
            <span className="ledger-line-desc">Every Group Policy Object: where it is linked, which half is off, who it is filtered to, and which are linked nowhere.</span>
            <span />
          </button>
        </div>
        <p className="ledger-note" style={{ marginTop: 22 }}>Read from the directory. The settings inside a policy live in SYSVOL and are not shown.</p>
      </div>
    </RegisterFrame>
  );
}

// ---- Trace: the answer -------------------------------------------------------
function TracePage({ target, onBack, onMap, onTrace, onPolicy, onPeople, onRow }: { target: Target } & Nav) {
  const [kind, setKind] = useState<"user" | "computer">("user");
  const [chain, setChain] = useState<gpo.Chain | null>(null);       // what is real
  const [tried, setTried] = useState<gpo.Chain | null>(null);       // the hypothetical, when changes are on
  const [changes, setChanges] = useState<Hypothetical[]>([]);
  const [counts, setCounts] = useState<main.Counts | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [machine, setMachine] = useState<Target | null>(null);        // signed in on this computer
  const [machineChain, setMachineChain] = useState<gpo.Chain | null>(null);
  const [machineTried, setMachineTried] = useState<gpo.Chain | null>(null);
  const [peer, setPeer] = useState<Target | null>(null);              // compared with this person
  const [peerChain, setPeerChain] = useState<gpo.Chain | null>(null);

  useEffect(() => { setChanges([]); setTried(null); setMachine(null); setMachineChain(null); setPeer(null); setPeerChain(null); }, [target.dn]);

  useEffect(() => {
    if (!peer) { setPeerChain(null); return; }
    let live = true;
    PolicyChainWith(peer.dn, []).then((c) => { if (live) setPeerChain(c); }).catch((e: any) => { if (live) setError(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [peer]);

  useEffect(() => {
    let live = true;
    setBusy(true); setError(""); setCounts(null);
    const p = target.kind === "container" ? ContainerChainWith(target.dn, kind, []) : PolicyChainWith(target.dn, []);
    p.then((c) => { if (live) { setChain(c); setBusy(false); } }).catch((e: any) => { if (live) { setError(String(e?.message ?? e)); setBusy(false); } });
    if (target.kind === "container") CountUnder(target.dn).then((c) => { if (live) setCounts(c); }).catch(() => {});
    return () => { live = false; };
  }, [target, kind]);

  const sig = JSON.stringify(changes);
  useEffect(() => {
    if (changes.length === 0) { setTried(null); return; }
    let live = true;
    const p = target.kind === "container" ? ContainerChainWith(target.dn, kind, toChanges(changes)) : PolicyChainWith(target.dn, toChanges(changes));
    p.then((c) => { if (live) setTried(c); }).catch((e: any) => { if (live) setError(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [sig, target, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // The computer half is the computer's own trace. Changes to the account
  // (joining a group, moving) say nothing about the machine, so it only sees
  // the ones that change the directory's links.
  const linkChanges = changes.filter((c) => c.kind !== "join" && c.kind !== "leave" && c.kind !== "move");
  const linkSig = JSON.stringify(linkChanges);
  useEffect(() => {
    if (!machine) { setMachineChain(null); setMachineTried(null); return; }
    let live = true;
    PolicyChainWith(machine.dn, []).then((c) => { if (live) setMachineChain(c); }).catch((e: any) => { if (live) setError(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [machine]);
  useEffect(() => {
    if (!machine || linkChanges.length === 0) { setMachineTried(null); return; }
    let live = true;
    PolicyChainWith(machine.dn, toChanges(linkChanges)).then((c) => { if (live) setMachineTried(c); }).catch(() => {});
    return () => { live = false; };
  }, [machine, linkSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = tried ?? chain;
  const machineShown = machineTried ?? machineChain;
  const containerKind = target.kind === "container" ? kind : undefined;
  const bottom = target.kind === "container"
    ? (counts ? `${counts.users.toLocaleString()} ${counts.users === 1 ? "user" : "users"}, ${counts.computers.toLocaleString()} ${counts.computers === 1 ? "computer" : "computers"}${counts.truncated ? " or more" : ""}` : "counting…")
    : target.label;
  const parentDN = target.dn.split(",").slice(1).join(",");
  const tryIt = (h: Hypothetical) => setChanges((cs) => (cs.some((c) => JSON.stringify(c) === JSON.stringify(h)) ? cs : [...cs, h]));

  // Containers to move an account to, for the "move to…" control.
  const findContainers = async (q: string): Promise<ContainerHit[]> => {
    const res = await Search(ldap.SearchRequest.createFrom({
      baseDN: target.dn.split(",").filter((p) => /^(dc)=/i.test(p)).join(","), scope: 2, pageSize: 8, sizeLimit: 8,
      filter: `(&(objectClass=organizationalUnit)(ou=*${escapeLdapValue(q.trim())}*))`, attributes: ["ou", "name"],
    }));
    return (res.entries ?? []).map((e) => ({ dn: e.dn, name: e.attributes?.ou?.[0] || e.attributes?.name?.[0] || e.dn }));
  };
  // Computers to sign this person in on.
  const findMachines = async (q: string): Promise<Target[]> => {
    const res = await Search(ldap.SearchRequest.createFrom({
      baseDN: target.dn.split(",").filter((p) => /^(dc)=/i.test(p)).join(","), scope: 2, pageSize: 8, sizeLimit: 8,
      filter: `(&(objectCategory=computer)(anr=${escapeLdapValue(q.trim())}))`, attributes: ["name", "dNSHostName"],
    }));
    return (res.entries ?? []).map((e) => ({ dn: e.dn, kind: "computer" as const, label: e.attributes?.name?.[0] || e.attributes?.dNSHostName?.[0] || e.dn }));
  };
  // People to compare this person with.
  const findPeople = async (q: string): Promise<Target[]> => {
    const res = await Search(ldap.SearchRequest.createFrom({
      baseDN: target.dn.split(",").filter((p) => /^(dc)=/i.test(p)).join(","), scope: 2, pageSize: 8, sizeLimit: 8,
      filter: `(&(objectCategory=person)(objectClass=user)(anr=${escapeLdapValue(q.trim())}))`, attributes: ["displayName", "sAMAccountName", "name"],
    }));
    return (res.entries ?? [])
      .filter((e) => e.dn.toLowerCase() !== target.dn.toLowerCase())
      .map((e) => ({ dn: e.dn, kind: "user" as const, label: e.attributes?.displayName?.[0] || e.attributes?.sAMAccountName?.[0] || e.attributes?.name?.[0] || e.dn }));
  };
  const exportTrace = () => {
    if (!shown) return;
    const cols = ["Policy", "Linked at", "Container", "Arrives", "Precedence", "Enforced", "Why", "Policy changed"];
    const rows = (shown.entries ?? []).map((e) => ({
      Policy: e.policy.name, "Linked at": e.somName, Container: e.somKind,
      Arrives: e.precedence > 0 ? "yes" : "no", Precedence: e.precedence > 0 ? String(e.precedence) : "",
      Enforced: e.enforced ? "yes" : "", Why: fateOf(e, shown).text, "Policy changed": e.policy.changed || "",
    }));
    const who = target.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    downloadCsv(`adquery-policy-trace-${who}-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(cols, rows));
  };
  const copyTrace = async () => {
    if (!shown) return;
    try { await navigator.clipboard.writeText(traceAsText(shown, target.label, target.kind === "container" ? `container${changes.length ? ", hypothetical" : ""}` : shown.targetKind)); toast.success("Trace copied"); }
    catch { toast.error("Couldn't copy"); }
  };

  return (
    <RegisterFrame
      eyebrow="Trace"
      back={{ label: "Policies", onClick: onBack }}
      title={target.label}
      lede={shown ? <>
        {peer && peerChain
          ? compareSentence(shown, peerChain, target.label, peer.label)
          : machine && machineShown
            ? `Signed in on ${machine.label}, ${target.label} gets ${countOf(shown)} and the machine gets ${countOf(machineShown)}.`
            : headline(shown, target.label, containerKind, tried ? chain : null)}
        {target.kind === "container" && <> Showing <button className={"ledger-link" + (kind === "user" ? " is-strong" : "")} onClick={() => setKind("user")}>users</button> · <button className={"ledger-link" + (kind === "computer" ? " is-strong" : "")} onClick={() => setKind("computer")}>computers</button>.</>}
      </> : busy ? "Tracing…" : undefined}
      meta={<>
        <span className="mono is-dim" title={target.dn}>{target.dn.length > 90 ? target.dn.slice(0, 89) + "…" : target.dn}</span>
        <span className="flex-1" />
        {target.kind === "user" && (machine || peer
          ? <button className="ledger-link" onClick={() => { setMachine(null); setPeer(null); }}>Just {target.label}</button>
          : <>
              <PickerLink label="On a computer…" word="signed in on" placeholder="a computer by name" find={findMachines} onPick={(t) => { setPeer(null); setMachine(t); }} />
              <PickerLink label="Compare with…" word="compare with" placeholder="a person by name" find={findPeople} onPick={(t) => { setMachine(null); setPeer(t); }} />
            </>)}
        <button className="ledger-link" onClick={exportTrace} disabled={!shown}>Export CSV</button>
        <button className="ledger-link" onClick={copyTrace} disabled={!shown}>Copy as text</button>
        {target.kind === "container"
          ? <button className="ledger-link" onClick={() => onPeople(target.dn)}>People in {target.label}</button>
          : <button className="ledger-link" onClick={() => onRow(target.dn)}>Open the row</button>}
        <button className="ledger-link" onClick={() => onMap(target.kind === "container" ? target.dn : parentDN)}>Show on the tree</button>
      </>}
    >
      <HypotheticalBar changes={changes} onRemove={(i) => setChanges((cs) => cs.filter((_, j) => j !== i))} onReset={() => setChanges([])} />
      {error && <div className="p-6"><ErrorBanner error={error} /></div>}
      {shown && peer && (
        <div className="ledger-pair">
          <section className="ledger-pair-col">
            <div className="ledger-h4">{target.label}<span className="ledger-h4-hint">{onlyFor(shown, peerChain).size} not shared</span></div>
            <PolicyFlow chain={shown} targetLabel={target.label} targetKind={shown.targetKind}
              onPickStation={(dn) => onTrace(containerTarget(dn))} onPickPolicy={onPolicy} onlyHere={onlyFor(shown, peerChain)} />
          </section>
          <section className="ledger-pair-col">
            <div className="ledger-h4">{peer.label}<span className="ledger-h4-hint">{peerChain ? onlyFor(peerChain, shown).size + " not shared" : ""}</span></div>
            {peerChain
              ? <PolicyFlow chain={peerChain} targetLabel={peer.label} targetKind={peerChain.targetKind}
                  onPickStation={(dn) => onTrace(containerTarget(dn))} onPickPolicy={onPolicy} onlyHere={onlyFor(peerChain, shown)} />
              : <p className="ledger-note">Tracing {peer.label}…</p>}
          </section>
          <p className="ledger-note ledger-pair-note">
            Marked lines are the ones only that person receives. Two people in the same container can still differ, because
            a policy can be filtered to a group one of them is in.
          </p>
        </div>
      )}
      {shown && machine && (
        <div className={"ledger-pair" + (tried || machineTried ? " is-hypo" : "")}>
          <section className="ledger-pair-col">
            <div className="ledger-h4">{target.label}<span className="ledger-h4-hint">user settings</span></div>
            <PolicyFlow chain={shown} baseline={tried ? chain : null} targetLabel={target.label} targetKind="user"
              onPickStation={(dn) => onTrace(containerTarget(dn))} onPickPolicy={onPolicy} tryIt={tryIt}
              person={{ name: target.label, findContainers }} />
          </section>
          <section className="ledger-pair-col">
            <div className="ledger-h4">{machine.label}<span className="ledger-h4-hint">computer settings</span></div>
            {machineShown
              ? <PolicyFlow chain={machineShown} baseline={machineTried ? machineChain : null} targetLabel={machine.label} targetKind="computer"
                  onPickStation={(dn) => onTrace(containerTarget(dn))} onPickPolicy={onPolicy} tryIt={tryIt} />
              : <p className="ledger-note">Tracing the machine…</p>}
          </section>
          <p className="ledger-note ledger-pair-note">
            A signed-in session takes the user settings from the person's own policies and the computer settings from the machine's.
            One exception the directory cannot show: a policy on the machine can turn on loopback processing, which makes the machine's
            user settings apply instead of the person's. That switch lives in SYSVOL, so check it there if the two disagree.
          </p>
        </div>
      )}
      {shown && !machine && !peer && (
        <div className={"ledger-page" + (tried ? " is-hypo" : "")}>
          <section className="ledger-page-main">
            <div className="ledger-h4">{tried ? "How it would get there" : "How it gets there"}<span className="ledger-h4-hint">hover a line to try a change</span></div>
            <PolicyFlow chain={shown} baseline={tried ? chain : null} targetLabel={bottom} targetKind={target.kind === "container" ? `in ${target.label}` : shown.targetKind}
              onPickStation={(dn) => onTrace(containerTarget(dn))} onPickPolicy={onPolicy} tryIt={tryIt}
              person={target.kind === "container" ? undefined : { name: target.label, findContainers }} />
            <PolicyExplainer chain={shown} />
          </section>
          <section className="ledger-page-side">
            {tried
              ? (changes.some((c) => c.kind !== "join" && c.kind !== "leave" && c.kind !== "move")
                  ? <ImpactList changes={changes} onTrace={(dn) => onTrace(containerTarget(dn))} title="And who else" />
                  : <><div className="ledger-h4">Only this account</div><p className="ledger-note">Group membership and a move change what this account receives. Nothing about the directory's links changes, so nobody else is affected.</p></>)
              : <Outcome chain={shown} onPolicy={onPolicy} />}
          </section>
        </div>
      )}
    </RegisterFrame>
  );
}

/** The answer without the working: what arrives, strongest first, and what does not. */
function Outcome({ chain, onPolicy }: { chain: gpo.Chain; onPolicy: (dn: string) => void }) {
  const entries = chain.entries ?? [];
  const arrives = entries.filter((e) => e.precedence > 0).sort((a, b) => a.precedence - b.precedence);
  const not = entries.filter((e) => e.precedence === 0);
  return (
    <>
      <div className="ledger-h4">Arrives, strongest first</div>
      {arrives.length === 0 && <p className="ledger-note">Nothing.</p>}
      <div className="ledger-lines">
        {arrives.map((e) => (
          <div key={e.policy.dn} className="ledger-line is-static">
            <span className="ledger-line-text"><span className="mono ledger-chain-num">{e.precedence}</span><button className="ledger-flow-pick" onClick={() => onPolicy(e.policy.dn)}>{e.policy.name}</button>{e.verdict === "depends" && <span className="ledger-flag warn">depends on group</span>}</span>
            <span className="ledger-line-desc">from {e.somName}{e.enforced ? ", enforced" : ""}{e.wmiUnknown ? ", if its WMI filter passes" : ""}</span>
          </div>
        ))}
      </div>
      {not.length > 0 && (
        <>
          <div className="ledger-h4">Linked above, does not arrive</div>
          <div className="ledger-lines">
            {not.map((e) => (
              <div key={e.policy.dn + e.somDN + e.verdict} className="ledger-line is-static">
                <span className="ledger-line-text"><button className="ledger-flow-pick is-out" onClick={() => onPolicy(e.policy.dn)} disabled={e.verdict === "not-found"}>{e.policy.name}</button></span>
                <span className="ledger-line-desc">{fateOf(e, chain).text}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ---- Policy: one policy's page -------------------------------------------------
function PolicyDetailPage({ dn, onBack, onTrace, onPeople, onMap }: { dn: string } & Nav) {
  const [inv, setInv] = useState<gpo.Inventory | null>(null);
  const [error, setError] = useState("");
  const [changes, setChanges] = useState<Hypothetical[]>([]);
  useEffect(() => {
    let live = true;
    setChanges([]);
    PolicyInventory().then((i) => { if (live) setInv(i); }).catch((e: any) => { if (live) setError(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [dn]);
  const entry = (inv?.policies ?? []).find((p) => p.policy.dn.toLowerCase() === dn.toLowerCase());
  const p = entry?.policy;
  const links = entry?.links ?? [];
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success("Copied"); } catch { toast.error("Couldn't copy"); } };
  const tryIt = (h: Hypothetical) => setChanges((cs) => (cs.some((c) => JSON.stringify(c) === JSON.stringify(h)) ? cs : [...cs, h]));
  const on = (kind: string, containerDN?: string) => changes.some((c) => c.kind === kind && (c.containerDN ?? "") === (containerDN ?? ""));

  const lede = p ? (() => {
    const where = links.length === 0 ? "linked nowhere" : "linked at " + links.map((l) => l.somName + (l.enforced ? " (enforced)" : "") + (l.disabled ? " (link switched off)" : "")).join(", ");
    const who = appliesTo(p, inv?.names);
    const halves = p.userDisabled && p.computerDisabled ? "Both halves are switched off." : p.userDisabled ? "Its user settings are switched off." : p.computerDisabled ? "Its computer settings are switched off." : "";
    return `${p.name} is ${where}. It applies to ${who}. ${halves}`.trim();
  })() : error ? undefined : "Reading…";

  return (
    <RegisterFrame eyebrow="Policy" back={{ label: "Policies", onClick: onBack }} title={p?.name ?? "Policy"} lede={lede}
      meta={p ? <>
        <span className="mono is-dim">{p.guid}</span>
        <span className="flex-1" />
        <button className="ledger-link" onClick={() => copy(p.path)} disabled={!p.path}>Copy SYSVOL path</button>
        <button className="ledger-link" onClick={() => copy(p.dn)}>Copy DN</button>
      </> : null}>
      <HypotheticalBar changes={changes} onRemove={(i) => setChanges((cs) => cs.filter((_, j) => j !== i))} onReset={() => setChanges([])} />
      {error && <div className="p-6"><ErrorBanner error={error} /></div>}
      {p && (
        <div className={"ledger-page" + (changes.length ? " is-hypo" : "")}>
          <section className="ledger-page-main">
            <div className="ledger-h4">Facts<span className="ledger-h4-hint">hover a line to try a change</span></div>
            <dl className="ledger-kv">
              <dt>Applies to</dt><dd>{appliesTo(p, inv?.names)}</dd>
              <dt>User settings</dt><dd>{p.userDisabled ? <span className="ledger-flag warn">switched off</span> : "on"}</dd>
              <dt>Computer settings</dt><dd>{p.computerDisabled ? <span className="ledger-flag warn">switched off</span> : "on"}
                {!(p.userDisabled && p.computerDisabled) && !on("policy-off") && <button className="ledger-try" onClick={() => tryIt({ kind: "policy-off", policyDN: p.dn, label: `${p.name} switched off` })}>try: switch the policy off</button>}
              </dd>
              <dt>WMI filter</dt><dd>{p.wmiFilter ? (p.wmiFilterName || <span className="mono">{p.wmiFilter}</span>) : "none"}</dd>
              <dt>Version</dt><dd>{p.version === 0 ? <span className="ledger-flag warn">never edited</span> : <><span className="mono">{p.version & 0xffff}</span> user, <span className="mono">{p.version >>> 16}</span> computer</>}</dd>
              <dt>Last changed</dt><dd>{p.changed ? <>{new Date(p.changed).toLocaleString()}{changedRecently(p) && <span className="ledger-flag warn">{changedRecently(p)}</span>}</> : "unknown"}</dd>
              <dt>GUID</dt><dd className="mono selectable">{p.guid}</dd>
              <dt>SYSVOL path</dt><dd className="mono selectable is-break">{p.path || "unknown"}</dd>
            </dl>
            <p className="ledger-note">The version counts how many times each half has been saved. The settings themselves live at the SYSVOL path and are not read here.</p>
            {changes.length > 0 && <ImpactList changes={changes} onTrace={(dn) => onTrace(containerTarget(dn))} title="Who would notice" />}
          </section>
          <section className="ledger-page-side">
            <div className="ledger-h4">Linked at</div>
            {links.length === 0 && <p className="ledger-note">Nowhere. The policy exists but no site, domain or organizational unit links it, so it reaches no one.</p>}
            <div className="ledger-lines">
              {links.map((l, i) => {
                const gone = on("unlink", l.somDN) || on("delete");
                return (
                  <div key={l.somDN + i} className={"ledger-line is-static" + (gone ? " is-gone" : "")}>
                    <span className="ledger-line-text">
                      <button className="ledger-flow-pick" onClick={() => onTrace(containerTarget(l.somDN))} title={l.somDN}>{l.somName}</button>
                      <small className="ledger-kind">{l.somKind === "ou" ? "organizational unit" : l.somKind}, link {l.order}</small>
                      {(l.enforced || on("enforce", l.somDN)) && !on("unenforce", l.somDN) && <span className="ledger-flag">enforced</span>}
                      {(l.disabled || on("link-off", l.somDN)) && <span className="ledger-flag warn">link switched off</span>}
                      {gone && <span className="ledger-flag warn">would be unlinked</span>}
                    </span>
                    <span className="ledger-line-desc ledger-line-acts">
                      <button className="ledger-link" onClick={() => onTrace(containerTarget(l.somDN))}>trace</button>
                      <button className="ledger-link" onClick={() => onPeople(l.somDN)}>people</button>
                      <button className="ledger-link" onClick={() => onMap(l.somDN)}>on the tree</button>
                      {!gone && <span className="ledger-try-group">
                        <button className="ledger-try" onClick={() => tryIt({ kind: "unlink", policyDN: p.dn, containerDN: l.somDN, label: `${p.name} unlinked from ${l.somName}` })}>try: unlink</button>
                        {l.enforced || on("enforce", l.somDN)
                          ? <button className="ledger-try" onClick={() => tryIt({ kind: "unenforce", policyDN: p.dn, containerDN: l.somDN, label: `${p.name} no longer enforced on ${l.somName}` })}>stop enforcing</button>
                          : <button className="ledger-try" onClick={() => tryIt({ kind: "enforce", policyDN: p.dn, containerDN: l.somDN, label: `${p.name} enforced on ${l.somName}` })}>enforce</button>}
                      </span>}
                    </span>
                  </div>
                );
              })}
            </div>
            {links.length > 0 && <p className="ledger-note">To see who actually receives this policy, open the people at a link and trace one of them.</p>}
          </section>
        </div>
      )}
    </RegisterFrame>
  );
}

// ---- Map: the tree -------------------------------------------------------------
function MapPage({ reveal, onBack, onTrace, onPolicy }: { reveal?: string } & Nav) {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [map, setMap] = useState<gpo.Map | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [find, setFind] = useState("");
  const [revealDN, setRevealDN] = useState<string | null>(reveal ?? null);

  async function load() {
    setPhase("loading"); setError("");
    try { setMap(await PolicyMap()); setPhase("ready"); }
    catch (e: any) { setError(String(e?.message ?? e)); setPhase("error"); }
  }
  useEffect(() => { load(); }, []);

  const matches = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!q || !map) return [];
    return (map.nodes ?? []).filter((n) => n.name.toLowerCase().includes(q)).slice(0, 8);
  }, [find, map]);

  const total = (map?.nodes ?? []).length;
  const shown = (map?.nodes ?? []).filter((n) => n.relevant).length;
  const policies = Object.keys(map?.policies ?? {}).length;

  return (
    <RegisterFrame
      eyebrow="The tree"
      back={{ label: "Policies", onClick: onBack }}
      title="Where policy is linked"
      lede={<>Every container that links or blocks policy, and the path down to it. Branches with nothing linked are folded; open them, or <InlineCheck checked={showAll} onChange={setShowAll} disabled={phase !== "ready"}>show every container</InlineCheck>. Click a container to trace what flows into it, or a policy to open it.</>}
      controls={
        <div className="ledger-controls-row">
          <span className="ledger-controls-word">find</span>
          <input className="ledger-inline-input" value={find} onChange={(e) => setFind(e.target.value)} placeholder="a container by name" aria-label="find a container" />
          {matches.map((m) => (
            <button key={m.dn} className="ledger-link" onClick={() => { setRevealDN(m.dn); setFind(""); }} title={m.dn}>{m.name}</button>
          ))}
          {find.trim() && matches.length === 0 && <span className="is-dim">no container by that name</span>}
        </div>
      }
      meta={phase === "ready" ? <>
        <span><b>{shown}</b> of {total.toLocaleString()} containers carry or pass policy</span>
        <span>{policies} policies</span>
        <button className="ledger-link" onClick={load}>rescan</button>
      </> : phase === "loading" ? <span>Reading the tree…</span> : null}
    >
      {phase === "error" && <div className="p-6"><ErrorBanner error={error} /></div>}
      {phase === "ready" && map && (
        <PolicyMapView map={map} expanded={expanded} showAll={showAll} revealDN={revealDN} selectedDN={revealDN}
          onToggle={(dn) => setExpanded((s) => { const n = new Set(s); const k = dn.toLowerCase(); n.has(k) ? n.delete(k) : n.add(k); return n; })}
          onSelect={(dn) => { const n = (map.nodes ?? []).find((x) => x.dn === dn); onTrace({ dn, kind: "container", label: n?.name ?? dn }); }}
          onPickPolicy={onPolicy} />
      )}
      {phase === "ready" && map?.notes?.length ? <p className="ledger-note" style={{ padding: "0 26px 14px" }}>{map.notes.join(" ")}</p> : null}
    </RegisterFrame>
  );
}

// ---- List: every policy ------------------------------------------------------
function ListPage({ onBack, onPolicy, onTrace }: Nav) {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [inv, setInv] = useState<gpo.Inventory | null>(null);
  const [error, setError] = useState("");
  const [oddOnly, setOddOnly] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);
  const [at, setAt] = useState<number | null>(null);

  async function load() {
    setPhase("loading"); setError("");
    try { setInv(await PolicyInventory()); setPhase("ready"); setAt(Date.now()); }
    catch (e: any) { setError(String(e?.message ?? e)); setPhase("error"); }
  }
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    let all = (inv?.policies ?? []).map((p) => ({ ...p, links: p.links ?? [] }));
    if (recentOnly) all = all.filter((p) => { const d = daysSince(p.policy.changed); return d !== null && d <= 30; });
    if (!oddOnly) return all;
    return all.filter((p) => p.links.length === 0 || p.policy.version === 0 || p.links.some((l) => l.disabled) || p.policy.userDisabled || p.policy.computerDisabled || p.policy.wmiFilter || (p.policy.applyDeny?.length ?? 0) > 0 || !(p.policy.applyAllow ?? []).includes(AUTHENTICATED_USERS));
  }, [inv, oddOnly, recentOnly]);
  const unlinked = (inv?.policies ?? []).filter((p) => (p.links ?? []).length === 0).length;

  function exportCsv() {
    const cols = ["Policy", "GUID", "Linked at", "Enforced", "Disabled links", "User settings", "Computer settings", "WMI filter", "Applies to", "Version", "Last changed"];
    const out = rows.map((p) => ({
      Policy: p.policy.name, GUID: p.policy.guid,
      "Linked at": p.links.map((l) => l.somName).join("; "),
      Enforced: p.links.filter((l) => l.enforced).map((l) => l.somName).join("; "),
      "Disabled links": p.links.filter((l) => l.disabled).map((l) => l.somName).join("; "),
      "User settings": p.policy.userDisabled ? "disabled" : "enabled", "Computer settings": p.policy.computerDisabled ? "disabled" : "enabled",
      "WMI filter": p.policy.wmiFilter ? (p.policy.wmiFilterName || "yes") : "", "Applies to": appliesTo(p.policy, inv?.names), Version: String(p.policy.version), "Last changed": p.policy.changed || "",
    }));
    downloadCsv(`adquery-policies-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(cols, out));
  }

  const asOf = at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <RegisterFrame
      eyebrow="All policies"
      back={{ label: "Policies", onClick: onBack }}
      title="Every Group Policy Object"
      lede={<>Where each is linked, which half is off, who it is filtered to, <InlineCheck checked={oddOnly} onChange={setOddOnly} disabled={phase !== "ready"}>only the ones worth a look</InlineCheck>, <InlineCheck checked={recentOnly} onChange={setRecentOnly} disabled={phase !== "ready"}>only those changed in the last 30 days</InlineCheck>. Click a policy to open it.</>}
      meta={phase === "ready" ? <>
        <span><b>{rows.length.toLocaleString()}</b> policies</span>
        <span>{unlinked} linked nowhere</span>
        {asOf && <span>as of {asOf} · <button className="ledger-link" onClick={load}>rescan</button></span>}
        <span className="flex-1" />
        <button className="ledger-link" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
      </> : phase === "loading" ? <span>Reading policies and links…</span> : null}
    >
      {phase === "error" && <div className="p-6"><ErrorBanner error={error} /></div>}
      {phase === "ready" && (
        <>
          <table className="ledger-table">
            <thead><tr><th className="is-num">#</th><th>Policy</th><th>Linked at</th><th>Notes</th><th>Applies to</th></tr></thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.policy.dn}>
                  <td className="is-num mono">{i + 1}</td>
                  <td><button className="ledger-link" onClick={() => onPolicy(p.policy.dn)}>{p.policy.name}</button> <span className="mono is-dim" title={p.policy.dn}>{p.policy.guid}</span></td>
                  <td className="is-2">
                    {p.links.length === 0 && <span className="ledger-flag warn">linked nowhere</span>}
                    {p.links.map((l, j) => (
                      <span key={l.somDN + j} className="ledger-linkplace" title={l.somDN}>
                        {j > 0 ? ", " : ""}<button className="ledger-link" onClick={() => onTrace(containerTarget(l.somDN))}>{l.somName}</button>{l.somKind === "site" ? " (site)" : ""}
                        {l.enforced && <span className="ledger-flag"> enforced</span>}
                        {l.disabled && <span className="ledger-flag warn"> link switched off</span>}
                      </span>
                    ))}
                  </td>
                  <td className="is-2">
                    {changedRecently(p.policy) && <span className="ledger-flag warn" title={p.policy.changed}>{changedRecently(p.policy)}</span>}
                    {p.policy.version === 0 && <span className="ledger-flag warn">never edited</span>}
                    {p.policy.userDisabled && <span className="ledger-flag warn">user settings off</span>}
                    {p.policy.computerDisabled && <span className="ledger-flag warn">computer settings off</span>}
                    {p.policy.wmiFilter && <span className="ledger-flag warn">wmi filter{p.policy.wmiFilterName ? `: ${p.policy.wmiFilterName}` : ""}</span>}
                    {p.policy.version > 0 && !changedRecently(p.policy) && !p.policy.userDisabled && !p.policy.computerDisabled && !p.policy.wmiFilter && <span className="is-dim">nothing unusual</span>}
                  </td>
                  <td className="is-2">{appliesTo(p.policy, inv?.names)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="is-empty">Nothing here needs a look.</td></tr>}
            </tbody>
          </table>
          <p className="ledger-note" style={{ padding: "14px 26px" }}>
            Read from the directory. What a policy sets is in SYSVOL and is not shown. "Never edited" means the policy's version is still zero.
            {inv?.notes?.length ? " " + inv.notes.join(" ") : ""}
          </p>
        </>
      )}
    </RegisterFrame>
  );
}
