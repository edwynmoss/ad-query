// The Policies side of a row: how policy flows down the tree to this user
// or computer, drawn by PolicyFlow.
import { useEffect, useState } from "react";
import { PolicyChain } from "../../wailsjs/go/main/App";
import type { gpo, ldap } from "../../wailsjs/go/models";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PolicyFlow } from "./PolicyFlow";

export function PoliciesSection({ entry, isAD }: { entry: ldap.Entry; isAD?: boolean }) {
  const dn = entry.dn;
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
        setError(msg);
        setStatus(/neither|plain LDAP/i.test(msg) ? "na" : "error");
      });
    return () => { live = false; };
  }, [dn, isAD]);

  if (status === "na") return <p className="ledger-note">{error || "Group Policy is an Active Directory feature. This directory reports as plain LDAP."}</p>;
  if (status === "loading") return <p className="ledger-note">Tracing policy down to this object…</p>;
  if (status === "error") return <ErrorBanner error={error} />;
  if (!chain) return null;

  const a = entry.attributes ?? {};
  const label = a.displayName?.[0] || a.cn?.[0] || a.name?.[0] || a.sAMAccountName?.[0] || dn.split(",")[0].replace(/^[^=]+=/, "");

  return (
    <div>
      <div className="ledger-h4">How policy flows down to this {chain.targetKind}</div>
      <PolicyFlow chain={chain} targetLabel={label} targetKind={chain.targetKind} />
      <p className="ledger-note" style={{ marginTop: 12 }}>Nearer wins, enforced wins over everything. {(chain.notes ?? []).join(" ")}</p>
    </div>
  );
}
