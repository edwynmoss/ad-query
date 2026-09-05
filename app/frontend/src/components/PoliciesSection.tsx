// The Policies side of a row: which Group Policy Objects reach this user or
// computer, laid out as the chain of containers above it and the links in
// precedence order, then the links that do not apply and why.
import { useEffect, useState } from "react";
import { PolicyChain } from "../../wailsjs/go/main/App";
import type { gpo } from "../../wailsjs/go/models";
import { ErrorBanner } from "@/components/ui/error-banner";

export const VERDICT_WORDS: Record<string, string> = {
  applies: "applies",
  "link-disabled": "link disabled",
  blocked: "blocked",
  denied: "denied",
  filtered: "filtered out",
  "half-disabled": "half disabled",
  "not-found": "missing",
};

export function verdictTone(v: string): string {
  if (v === "denied" || v === "not-found") return "crit";
  if (v === "applies") return "";
  return "warn";
}

/** Replace raw SIDs in a sentence with the names the backend resolved. */
export function nameSids(text: string, names: Record<string, string> | undefined): string {
  if (!names) return text;
  return text.replace(/S-1-\d+(?:-\d+)+/g, (sid) => names[sid.toUpperCase()] ?? sid);
}

export function PoliciesSection({ dn, isAD }: { dn: string; isAD?: boolean }) {
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "na">("loading");
  const [chain, setChain] = useState<gpo.Chain | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAD === false) { setStatus("na"); return; }
    let live = true;
    setStatus("loading");
    PolicyChain(dn)
      .then((c) => { if (live) { setChain(c); setStatus("ok"); } })
      .catch((e: any) => {
        if (!live) return;
        const msg = String(e?.message ?? e);
        if (/neither|plain LDAP/i.test(msg)) { setError(msg); setStatus("na"); } else { setError(msg); setStatus("error"); }
      });
    return () => { live = false; };
  }, [dn, isAD]);

  if (status === "na") return <p className="ledger-note">{error || "Group Policy is an Active Directory feature. This directory reports as plain LDAP."}</p>;
  if (status === "loading") return <p className="ledger-note">Reading the policy chain…</p>;
  if (status === "error") return <ErrorBanner error={error} />;
  if (!chain) return null;

  const entries = chain.entries ?? [];
  const path = chain.path ?? [];
  const notes = chain.notes ?? [];
  const applying = entries.filter((e) => e.precedence > 0);
  const rest = entries.filter((e) => e.precedence === 0);

  return (
    <div>
      <div className="ledger-h4">Where it sits</div>
      <div className="ledger-strip">
        {path.map((s, i) => (
          <span key={s.dn} className="ledger-strip-item" title={s.dn}>
            {i > 0 && <span className="ledger-strip-sep">›</span>}
            <span className={s.kind === "domain" ? "mono" : ""}>{s.name}</span>
            {s.blockInheritance && <span className="ledger-flag warn">blocks inheritance</span>}
          </span>
        ))}
      </div>

      <div className="ledger-h4">Applies, in order of precedence</div>
      {applying.length === 0 && <p className="ledger-note">No policy reaches this {chain.targetKind}.</p>}
      <div className="ledger-lines">
        {applying.map((e) => (
          <div key={e.policy.dn + e.somDN} className="ledger-line is-static is-chain">
            <span className="ledger-line-text">
              <span className="mono ledger-chain-num">{e.precedence}</span>
              <span className="ledger-chain-name">{e.policy.name}</span>
              {e.enforced && <span className="ledger-flag">enforced</span>}
              {e.wmiUnknown && <span className="ledger-flag warn">wmi unknown</span>}
              {!e.policy.aclKnown && <span className="ledger-flag warn">filtering unread</span>}
            </span>
            <span className="ledger-line-desc">linked at {e.somName}{e.somKind === "site" ? " (site)" : ""}{e.reason ? ". " + nameSids(e.reason, chain.names) : ""}</span>
          </div>
        ))}
      </div>

      {rest.length > 0 && (
        <>
          <div className="ledger-h4">Linked above, but does not apply</div>
          <div className="ledger-lines">
            {rest.map((e) => (
              <div key={e.policy.dn + e.somDN + e.verdict} className="ledger-line is-static is-chain">
                <span className="ledger-line-text">
                  <span className={"ledger-flag " + verdictTone(e.verdict)}>{VERDICT_WORDS[e.verdict] ?? e.verdict}</span>
                  <span className="ledger-chain-name">{e.policy.name}</span>
                </span>
                <span className="ledger-line-desc">linked at {e.somName}. {nameSids(e.reason, chain.names)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {notes.map((n, i) => <p key={i} className="ledger-note" style={{ marginTop: 10 }}>{n}</p>)}
    </div>
  );
}
