import { useEffect, useState } from "react";
import { X, Loader2, RefreshCw } from "lucide-react";
import { ldap, type adtypes } from "../../wailsjs/go/models";
import { GetACL, AccurateLastLogon, Search } from "../../wailsjs/go/main/App";
import { formatValue } from "../lib/format";
import { assessRisk, RISK_ATTRS, riskTone } from "../lib/risk";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { ErrorBanner } from "@/components/ui/error-banner";
import { labelFor } from "@/lib/attrLabels";

interface Props {
  entry: ldap.Entry | null;
  onClose: () => void;
}

export function Inspector({ entry, onClose }: Props) {
  if (!entry) return null;
  return <InspectorBody key={entry.dn} entry={entry} onClose={onClose} />;
}

function InspectorBody({ entry, onClose }: { entry: ldap.Entry; onClose: () => void }) {
  const [tab, setTab] = useState<"attrs" | "login" | "risk" | "acl">("attrs");
  const attrs = Object.keys(entry.attributes ?? {}).sort();

  return (
    <div className="w-[360px] shrink-0 flex flex-col min-h-0 border-l border-line bg-surface">
      <div className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-line">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-wide text-ink-3">DISTINGUISHED NAME</div>
          <div className="text-[12px] break-all selectable font-mono">{entry.dn}</div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose} aria-label="close"><X size={15} /></Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="px-3 border-b border-line">
        <TabsList>
          <TabsTrigger value="attrs">Attributes</TabsTrigger>
          <TabsTrigger value="login">Login</TabsTrigger>
          <TabsTrigger value="risk">Risk</TabsTrigger>
          <TabsTrigger value="acl">Security</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex-1 overflow-auto p-3">
        {tab === "attrs" && (
          <dl className="space-y-2">
            {attrs.map((a) => (
              <div key={a}>
                <dt className="text-[11px] font-semibold text-ink-2">{labelFor(a)} <span className="font-mono font-normal text-ink-3">{a}</span></dt>
                <dd className="text-[12px] break-words selectable font-mono">{formatValue(a, entry.attributes[a], "\n")}</dd>
              </div>
            ))}
            {attrs.length === 0 && <div className="text-[12px] text-ink-3">No attributes returned.</div>}
          </dl>
        )}
        {tab === "login" && <LoginTab entry={entry} />}
        {tab === "risk" && <RiskTab dn={entry.dn} />}
        {tab === "acl" && <AclTab dn={entry.dn} />}
      </div>
    </div>
  );
}

// AD's lastLogon isn't replicated; lastLogonTimestamp is (but lags). "Fast" =
// the replicated value; "Accurate" queries every DC for the newest lastLogon.
function LoginTab({ entry }: { entry: ldap.Entry }) {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [report, setReport] = useState<ldap.LastLogonReport | null>(null);
  const [error, setError] = useState("");

  const fast = entry.attributes?.lastLogonTimestamp?.[0] ?? "";

  async function check() {
    setStatus("loading"); setError("");
    try { setReport(await AccurateLastLogon(entry.dn)); setStatus("ok"); }
    catch (e: any) { setError(String(e?.message ?? e)); setStatus("error"); }
  }

  const tone: StatusTone = report?.confidence === "High" ? "success" : report?.confidence === "Medium" ? "warning" : "neutral";

  return (
    <div className="space-y-3 text-[12px]">
      <div>
        <div className="eyebrow text-ink-3 mb-1">Replicated (fast)</div>
        <div className="font-mono">{fast ? formatValue("lastLogonTimestamp", [fast]) : "—"}</div>
        <p className="text-[11px] text-ink-3 mt-0.5">From <span className="font-mono">lastLogonTimestamp</span> — replicated but lags by days.</p>
      </div>

      <div className="pt-2.5 border-t border-line">
        <div className="flex items-center justify-between mb-1.5">
          <div className="eyebrow text-ink-3">Accurate (all DCs)</div>
          <Button variant="outline" size="sm" onClick={check} disabled={status === "loading"}>
            {status === "loading" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {report ? "Re-check" : "Check"}
          </Button>
        </div>
        {status === "idle" && <p className="text-[11px] text-ink-3"><span className="font-mono">lastLogon</span> isn't replicated, so the true last login is the newest across every domain controller. This queries them all.</p>}
        {status === "loading" && <div className="flex items-center gap-2 text-ink-2"><Loader2 size={14} className="animate-spin" /> Querying domain controllers…</div>}
        {status === "error" && <ErrorBanner error={error} />}
        {status === "ok" && report && (
          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[13px]">{report.accurateLastLogon ? formatValue("lastLogon", [report.accurateLastLogon]) : "No login recorded"}</span>
              <StatusBadge tone={tone}>{report.confidence}</StatusBadge>
            </div>
            <dl className="text-[11.5px] space-y-0.5">
              {report.sourceDC && <div className="flex justify-between gap-2"><dt className="text-ink-3">Source DC</dt><dd className="font-mono">{report.sourceDC}</dd></div>}
              <div className="flex justify-between gap-2"><dt className="text-ink-3">DCs queried</dt><dd className="font-mono">{report.reachedDCs}/{report.queriedDCs} responded</dd></div>
            </dl>
            <p className="text-[11px] text-ink-3">{report.note}</p>
            {report.perDC.some((d) => !d.reachable) && (
              <div className="text-[11px] text-warning">{report.perDC.filter((d) => !d.reachable).map((d) => d.dc).join(", ")} did not respond.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Risk flags derived from the user's posture attributes (fetched fresh so the
// assessment is complete regardless of which columns the query returned).
function RiskTab({ dn }: { dn: string }) {
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

  if (status === "loading") return <div className="flex items-center gap-2 text-[12px] text-ink-2"><Loader2 size={14} className="animate-spin" /> Assessing risk…</div>;
  if (status === "error") return <ErrorBanner error={error} />;
  if (!assessment) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="eyebrow text-ink-3">Overall</span>
        <StatusBadge tone={riskTone(assessment.level)}>{assessment.level}</StatusBadge>
      </div>
      {assessment.flags.length === 0 ? (
        <p className="text-[12px] text-ink-2">No risk indicators — account looks healthy.</p>
      ) : (
        <ul className="space-y-2">
          {assessment.flags.map((f, i) => (
            <li key={i} className="border border-line rounded-md p-2">
              <div className="flex items-center gap-2">
                <StatusBadge tone={riskTone(f.level)}>{f.level}</StatusBadge>
                <span className="text-[12px] font-medium">{f.label}</span>
              </div>
              <p className="text-[11.5px] text-ink-2 mt-1">{f.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AclTab({ dn }: { dn: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [acl, setAcl] = useState<adtypes.SecurityDescriptor | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setStatus("loading"); setError("");
    try { setAcl(await GetACL(dn)); setStatus("ok"); }
    catch (e: any) { setError(String(e?.message ?? e)); setStatus("error"); }
  }

  if (status === "idle") {
    return (
      <div className="space-y-2">
        <p className="text-[12px] text-ink-2">Read the object's security descriptor (owner, group, and access-control entries).</p>
        <Button variant="outline" size="sm" onClick={load}>Load security descriptor</Button>
      </div>
    );
  }
  if (status === "loading") return <div className="flex items-center gap-2 text-[12px] text-ink-2"><Loader2 size={14} className="animate-spin" /> Reading…</div>;
  if (status === "error") return <div className="text-[12px] selectable text-warning">{error}</div>;

  return (
    <div className="space-y-3">
      {(acl?.owner || acl?.group) && (
        <div className="space-y-1 text-[12px]">
          {acl?.owner && <div><span className="text-ink-3">Owner </span><span className="font-mono">{acl.owner}</span></div>}
          {acl?.group && <div><span className="text-ink-3">Group </span><span className="font-mono">{acl.group}</span></div>}
        </div>
      )}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold tracking-wide text-ink-3">DACL · {(acl?.dacl ?? []).length} ACE</div>
        {(acl?.dacl ?? []).map((ace, i) => <AceRow key={i} ace={ace} />)}
        {(acl?.dacl ?? []).length === 0 && <div className="text-[12px] text-ink-3">No ACEs.</div>}
      </div>
    </div>
  );
}

function AceRow({ ace }: { ace: adtypes.ACE }) {
  return (
    <div className="p-1.5 rounded-md border border-line bg-surface">
      <div className="flex items-center gap-1.5">
        <StatusBadge tone={ace.allow ? "success" : "critical"}>{ace.allow ? "ALLOW" : "DENY"}</StatusBadge>
        <span className="text-[11.5px] truncate selectable font-mono" title={ace.sid}>{ace.trustee}</span>
      </div>
      {ace.rights && ace.rights.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {ace.rights.map((r, i) => <Badge key={i} variant="secondary" className="font-mono font-normal text-[10.5px] px-1.5 py-0">{r}</Badge>)}
        </div>
      )}
      {ace.objectType && (
        <div className="text-[10px] mt-1 truncate text-ink-3 font-mono" title={ace.objectType}>obj: {ace.objectType}</div>
      )}
    </div>
  );
}
