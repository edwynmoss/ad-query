// One row in full, set as a page of the ledger: the record's name, its
// distinguished name, then four sections under a typographic switch.
// Attributes are the columns the query returned; Login, Risk and Security
// fetch what they need on demand.
import { useEffect, useState } from "react";
import { ldap, type adtypes } from "../../wailsjs/go/models";
import { GetACL, AccurateLastLogon, Search } from "../../wailsjs/go/main/App";
import { formatValue } from "../lib/format";
import { assessRisk, RISK_ATTRS } from "../lib/risk";
import { ErrorBanner } from "@/components/ui/error-banner";
import { labelFor } from "@/lib/attrLabels";
import { PoliciesSection } from "./PoliciesSection";

type Section = "attrs" | "login" | "risk" | "policies" | "acl";
const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: "attrs", label: "Attributes" },
  { key: "login", label: "Login" },
  { key: "risk", label: "Risk" },
  { key: "policies", label: "Policies" },
  { key: "acl", label: "Security" },
];

function nameOf(entry: ldap.Entry): string {
  const a = entry.attributes ?? {};
  return a.displayName?.[0] || a.cn?.[0] || a.name?.[0] || a.sAMAccountName?.[0] || entry.dn.split(",")[0].replace(/^[^=]+=/, "");
}

export function InspectorBody({ entry, isAD, onClose }: { entry: ldap.Entry; isAD?: boolean; onClose: () => void }) {
  const [section, setSection] = useState<Section>("attrs");
  const attrs = Object.keys(entry.attributes ?? {}).sort();

  return (
    <div className="ledger-record">
      <div className="ledger-record-head">
        <div className="ledger-eyebrow">Row</div>
        <div className="ledger-record-name">{nameOf(entry)}</div>
        <div className="ledger-record-dn mono selectable" title={entry.dn}>{entry.dn}</div>
        <button className="ledger-link ledger-record-clear" onClick={onClose}>clear</button>
      </div>

      <div className="ledger-record-switch" role="tablist">
        {SECTIONS.map((s) => (
          <button key={s.key} role="tab" aria-selected={section === s.key} className={"ledger-tab" + (section === s.key ? " is-on" : "")} onClick={() => setSection(s.key)}>{s.label}</button>
        ))}
      </div>

      <div className="ledger-record-body">
        {section === "attrs" && (
          <dl className="ledger-attrs">
            {attrs.map((a) => (
              <div key={a} className="ledger-attr">
                <dt>{labelFor(a)} <code>{a}</code></dt>
                <dd className="mono selectable">{formatValue(a, entry.attributes[a], "\n")}</dd>
              </div>
            ))}
            {attrs.length === 0 && <p className="ledger-note">No attributes returned.</p>}
          </dl>
        )}
        {section === "login" && <LoginSection entry={entry} isAD={isAD} />}
        {section === "risk" && <RiskSection dn={entry.dn} />}
        {section === "policies" && <PoliciesSection entry={entry} isAD={isAD} />}
        {section === "acl" && <AclSection dn={entry.dn} />}
      </div>
    </div>
  );
}

// AD's lastLogon isn't replicated; lastLogonTimestamp is (but lags). The
// replicated value is instant; the accurate one asks every domain controller.
function LoginSection({ entry, isAD }: { entry: ldap.Entry; isAD?: boolean }) {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [report, setReport] = useState<ldap.LastLogonReport | null>(null);
  const [error, setError] = useState("");

  if (isAD === false) {
    return <p className="ledger-note">Last-login tracking is an Active Directory feature. This directory does not record per-account logins.</p>;
  }

  const fast = entry.attributes?.lastLogonTimestamp?.[0] ?? "";

  async function check() {
    setStatus("loading"); setError("");
    try { setReport(await AccurateLastLogon(entry.dn)); setStatus("ok"); }
    catch (e: any) { setError(String(e?.message ?? e)); setStatus("error"); }
  }

  const tone = report?.confidence === "High" ? "" : report?.confidence === "Medium" ? "warn" : "";

  return (
    <div>
      <div className="ledger-h4">Replicated, fast</div>
      <div className="mono ledger-figure">{fast ? formatValue("lastLogonTimestamp", [fast]) : "not recorded"}</div>
      <p className="ledger-note">From lastLogonTimestamp. Replicated to every domain controller, but lags by days.</p>

      <div className="ledger-h4">Accurate, all domain controllers</div>
      {status === "idle" && (
        <p className="ledger-note">lastLogon is not replicated, so the true last login is the newest across every domain controller. <button className="ledger-link" onClick={check}>Ask them all</button>.</p>
      )}
      {status === "loading" && <p className="ledger-note">Querying domain controllers…</p>}
      {status === "error" && <ErrorBanner error={error} />}
      {status === "ok" && report && (
        <>
          <div className="ledger-figure">
            <span className="mono">{report.accurateLastLogon ? formatValue("lastLogon", [report.accurateLastLogon]) : "No login recorded"}</span>
            <span className={"ledger-flag " + tone} style={{ marginLeft: 10 }}>{report.confidence} confidence</span>
          </div>
          <dl className="ledger-facts-dl">
            {report.sourceDC && <><dt>Source DC</dt><dd className="mono">{report.sourceDC}</dd></>}
            <dt>Responded</dt><dd className="mono">{report.reachedDCs} of {report.queriedDCs}</dd>
          </dl>
          <p className="ledger-note">{report.note}</p>
          {report.perDC.some((d) => !d.reachable) && (
            <p className="ledger-note" style={{ color: "var(--color-warning)" }}>{report.perDC.filter((d) => !d.reachable).map((d) => d.dc).join(", ")} did not respond.</p>
          )}
          <p className="ledger-note"><button className="ledger-link" onClick={check}>Ask again</button></p>
        </>
      )}
    </div>
  );
}

// Risk flags from the account's posture attributes, fetched fresh so the
// assessment is complete whatever columns the query returned.
function RiskSection({ dn }: { dn: string }) {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [assessment, setAssessment] = useState<ReturnType<typeof assessRisk> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await Search(ldap.SearchRequest.createFrom({ baseDN: dn, scope: 0, filter: "(objectClass=*)", attributes: RISK_ATTRS, pageSize: 1, sizeLimit: 0 }));
        setAssessment(assessRisk(res.entries?.[0]?.attributes ?? {}));
        setStatus("ok");
      } catch (e: any) { setError(String(e?.message ?? e)); setStatus("error"); }
    })();
  }, [dn]);

  if (status === "loading") return <p className="ledger-note">Assessing risk…</p>;
  if (status === "error") return <ErrorBanner error={error} />;
  if (!assessment) return null;
  if (assessment.notApplicable) {
    return <p className="ledger-note">Risk flags come from Active Directory posture: account status, password policy, delegation, service accounts. This directory does not expose those attributes.</p>;
  }

  const toneOf = (level: string) => (/critical|high/i.test(level) ? "crit" : /medium|warn/i.test(level) ? "warn" : "");

  return (
    <div>
      <div className="ledger-figure">Overall <span className={"ledger-flag " + toneOf(assessment.level)} style={{ marginLeft: 8 }}>{assessment.level}</span></div>
      {assessment.flags.length === 0 ? (
        <p className="ledger-note">No risk indicators. The account looks healthy.</p>
      ) : (
        <div className="ledger-lines" style={{ marginTop: 10 }}>
          {assessment.flags.map((f, i) => (
            <div key={i} className="ledger-line is-static">
              <span className="ledger-line-text"><span className={"ledger-flag " + toneOf(f.level)}>{f.level}</span>{f.label}</span>
              <span className="ledger-line-desc">{f.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AclSection({ dn }: { dn: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [acl, setAcl] = useState<adtypes.SecurityDescriptor | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setStatus("loading"); setError("");
    try { setAcl(await GetACL(dn)); setStatus("ok"); }
    catch (e: any) { setError(String(e?.message ?? e)); setStatus("error"); }
  }

  if (status === "idle") return <p className="ledger-note">The security descriptor: owner, group and each access-control entry. <button className="ledger-link" onClick={load}>Read it</button>.</p>;
  if (status === "loading") return <p className="ledger-note">Reading…</p>;
  if (status === "error") return <ErrorBanner error={error} />;

  const dacl = acl?.dacl ?? [];
  return (
    <div>
      {(acl?.owner || acl?.group) && (
        <dl className="ledger-facts-dl" style={{ marginTop: 0 }}>
          {acl?.owner && <><dt>Owner</dt><dd className="mono selectable">{acl.owner}</dd></>}
          {acl?.group && <><dt>Group</dt><dd className="mono selectable">{acl.group}</dd></>}
        </dl>
      )}
      <div className="ledger-h4">Access control, {dacl.length} entr{dacl.length === 1 ? "y" : "ies"}</div>
      <div className="ledger-lines">
        {dacl.map((ace, i) => <AceLine key={i} ace={ace} />)}
        {dacl.length === 0 && <p className="ledger-note">No entries.</p>}
      </div>
    </div>
  );
}

function AceLine({ ace }: { ace: adtypes.ACE }) {
  return (
    <div className="ledger-line is-static">
      <span className="ledger-line-text">
        <span className={"ledger-flag " + (ace.allow ? "" : "crit")}>{ace.allow ? "allow" : "deny"}</span>
        <span className="mono selectable" title={ace.sid}>{ace.trustee}</span>
      </span>
      {ace.rights && ace.rights.length > 0 && <span className="ledger-line-desc mono">{ace.rights.join(", ")}</span>}
      {ace.objectType && <span className="ledger-line-desc mono is-dim" title={ace.objectType}>on {ace.objectType}</span>}
    </div>
  );
}
