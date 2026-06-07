import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import type { ldap, adtypes } from "../../wailsjs/go/models";
import { GetACL } from "../../wailsjs/go/main/App";
import { formatValue } from "../lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Props {
  entry: ldap.Entry | null;
  onClose: () => void;
}

export function Inspector({ entry, onClose }: Props) {
  if (!entry) return null;
  return <InspectorBody key={entry.dn} entry={entry} onClose={onClose} />;
}

function InspectorBody({ entry, onClose }: { entry: ldap.Entry; onClose: () => void }) {
  const [tab, setTab] = useState<"attrs" | "acl">("attrs");
  const attrs = Object.keys(entry.attributes ?? {}).sort();

  return (
    <div className="w-[360px] shrink-0 flex flex-col min-h-0" style={{ borderLeft: "1px solid var(--color-line)", background: "var(--color-surface)" }}>
      <div className="flex items-start justify-between gap-2 px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-line)" }}>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-wide" style={{ color: "var(--color-ink-3)" }}>DISTINGUISHED NAME</div>
          <div className="text-[12px] break-all selectable" style={{ fontFamily: "var(--font-mono)" }}>{entry.dn}</div>
        </div>
        <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose} aria-label="close"><X size={15} /></Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="px-3" style={{ borderBottom: "1px solid var(--color-line)" }}>
        <TabsList>
          <TabsTrigger value="attrs">Attributes</TabsTrigger>
          <TabsTrigger value="acl">Security</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex-1 overflow-auto p-3">
        {tab === "attrs" ? (
          <dl className="space-y-2">
            {attrs.map((a) => (
              <div key={a}>
                <dt className="text-[11px] font-semibold" style={{ color: "var(--color-ink-3)", fontFamily: "var(--font-mono)" }}>{a}</dt>
                <dd className="text-[12px] break-words selectable" style={{ fontFamily: "var(--font-mono)" }}>{formatValue(a, entry.attributes[a], "\n")}</dd>
              </div>
            ))}
            {attrs.length === 0 && <div className="text-[12px]" style={{ color: "var(--color-ink-3)" }}>No attributes returned.</div>}
          </dl>
        ) : (
          <AclTab dn={entry.dn} />
        )}
      </div>
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
        <p className="text-[12px]" style={{ color: "var(--color-ink-2)" }}>Read the object's security descriptor (owner, group, and access-control entries).</p>
        <Button variant="outline" size="sm" onClick={load}>Load security descriptor</Button>
      </div>
    );
  }
  if (status === "loading") return <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--color-ink-2)" }}><Loader2 size={14} className="animate-spin" /> Reading…</div>;
  if (status === "error") return <div className="text-[12px] selectable" style={{ color: "var(--color-warn)" }}>{error}</div>;

  return (
    <div className="space-y-3">
      {(acl?.owner || acl?.group) && (
        <div className="space-y-1 text-[12px]">
          {acl?.owner && <div><span style={{ color: "var(--color-ink-3)" }}>Owner </span><span style={{ fontFamily: "var(--font-mono)" }}>{acl.owner}</span></div>}
          {acl?.group && <div><span style={{ color: "var(--color-ink-3)" }}>Group </span><span style={{ fontFamily: "var(--font-mono)" }}>{acl.group}</span></div>}
        </div>
      )}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold tracking-wide" style={{ color: "var(--color-ink-3)" }}>DACL · {(acl?.dacl ?? []).length} ACE</div>
        {(acl?.dacl ?? []).map((ace, i) => <AceRow key={i} ace={ace} />)}
        {(acl?.dacl ?? []).length === 0 && <div className="text-[12px]" style={{ color: "var(--color-ink-3)" }}>No ACEs.</div>}
      </div>
    </div>
  );
}

function AceRow({ ace }: { ace: adtypes.ACE }) {
  return (
    <div className="p-1.5 rounded" style={{ border: "1px solid var(--color-line)", background: "var(--color-surface)" }}>
      <div className="flex items-center gap-1.5">
        <Badge
          variant="outline"
          className="border-transparent"
          style={
            ace.allow
              ? { background: "var(--color-ok-weak)", color: "var(--color-ok)" }
              : { background: "var(--color-danger-weak)", color: "var(--color-danger)" }
          }
        >
          {ace.allow ? "ALLOW" : "DENY"}
        </Badge>
        <span className="text-[11.5px] truncate selectable" style={{ fontFamily: "var(--font-mono)" }} title={ace.sid}>{ace.trustee}</span>
      </div>
      {ace.rights && ace.rights.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {ace.rights.map((r, i) => <Badge key={i} variant="secondary" className="font-mono font-normal text-[10.5px] px-1.5 py-0">{r}</Badge>)}
        </div>
      )}
      {ace.objectType && (
        <div className="text-[10px] mt-1 truncate" style={{ color: "var(--color-ink-3)", fontFamily: "var(--font-mono)" }} title={ace.objectType}>obj: {ace.objectType}</div>
      )}
    </div>
  );
}
