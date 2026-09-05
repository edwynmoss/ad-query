// The heading of the sheet. What you are asking, set as a sentence: an eyebrow
// for the type, the place and the columns; a prose "where" line whose
// fragments open the filter builder; the search rule; and a meta line with the
// count and the actions on the result. Replaces the old toolbar.
import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import type { QueryState, DirLocation } from "./QueryBar";
import { effectiveFilter } from "./QueryBar";
import { OBJECT_TYPES, filterFor, defaultAttributesFor, COMMON_ATTRIBUTES } from "../lib/objectTypes";
import { labelFor, COMMON_COLUMNS } from "../lib/attrLabels";
import { describeCondition, describeLocation, describeType } from "../lib/describe";
import { isConditionValid } from "../lib/filterBuilder";
import { useDebouncedValue } from "../lib/hooks";
import { saveQuery } from "../lib/savedQueries";
import { FilterBuilder } from "./FilterBuilder";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";

export type Picker = null | "type" | "location" | "filters" | "columns";

interface Props {
  req: QueryState;
  setReq: (q: QueryState) => void;
  isAD: boolean;
  running: boolean;
  onRun: () => void;
  locations: DirLocation[];
  schemaAttributes: string[];
  /** Result meta, when a result is on the sheet. */
  result: { count: number; truncated: boolean; fetchedAt: number | null; fromCache: boolean; sortLabel: string | null } | null;
  onRescan: () => void;
  signedIn365: boolean;
  onCheck365: () => void;
  onExport: () => void;
  onSaved: () => void;
  /** A picker requested from elsewhere (the opening sheet). */
  requestedPicker: { kind: Picker; nonce: number } | null;
}

export function QueryHeading({ req, setReq, isAD, running, onRun, locations, schemaAttributes, result, onRescan, signedIn365, onCheck365, onExport, onSaved, requestedPicker }: Props) {
  const [picker, setPicker] = useState<Picker>(null);
  const [filterMode, setFilterMode] = useState<"visual" | "raw">("visual");
  const [newAttr, setNewAttr] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const debouncedAttr = useDebouncedValue(newAttr, 100);

  useEffect(() => { if (requestedPicker?.kind) setPicker(requestedPicker.kind); }, [requestedPicker]);

  const activeType = OBJECT_TYPES.find((t) => filterFor(t, isAD) === req.filter)?.key ?? "";
  const attrSource = schemaAttributes.length > 0 ? schemaAttributes : COMMON_ATTRIBUTES;
  const conditions = req.conditions.filter(isConditionValid);

  const locs = useMemo<DirLocation[]>(() => {
    const list: DirLocation[] = locations.length ? [...locations] : req.baseDN ? [{ dn: req.baseDN, label: "Entire directory", depth: 0 }] : [];
    if (req.baseDN && !list.some((l) => l.dn === req.baseDN)) list.unshift({ dn: req.baseDN, label: "Custom location", depth: 0 });
    return list;
  }, [locations, req.baseDN]);

  const schemaLower = useMemo(() => new Set(schemaAttributes.map((a) => a.toLowerCase())), [schemaAttributes]);
  const commonAvailable = useMemo(() => (schemaLower.size ? COMMON_COLUMNS.filter((a) => schemaLower.has(a.toLowerCase())) : COMMON_COLUMNS), [schemaLower]);
  const colMatches = useMemo(() => {
    const q = debouncedAttr.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const a of [...commonAvailable, ...attrSource]) {
      const lc = a.toLowerCase();
      if (seen.has(lc)) continue;
      seen.add(lc);
      if (lc.includes(q) || labelFor(a).toLowerCase().includes(q)) out.push(a);
      if (out.length >= 60) break;
    }
    return out;
  }, [debouncedAttr, attrSource, commonAvailable]);

  function applyType(key: string) {
    const t = OBJECT_TYPES.find((x) => x.key === key);
    if (t) setReq({ ...req, filter: filterFor(t, isAD), attributes: defaultAttributesFor(t, isAD) });
    setPicker(null);
  }
  function toggleAttr(a: string) {
    setReq(req.attributes.includes(a) ? { ...req, attributes: req.attributes.filter((x) => x !== a) } : { ...req, attributes: [...req.attributes, a] });
  }
  function confirmSave() {
    const n = name.trim();
    if (n) { saveQuery(n, req); toast.success(`Saved “${n}”`); onSaved(); }
    setName(""); setNaming(false);
  }

  const typeLabel = describeType(req, isAD);
  const locationLabel = describeLocation(req, locs);
  const asOf = result?.fetchedAt ? new Date(result.fetchedAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="ledger-qhead">
      <Popover open={picker !== null} onOpenChange={(o) => { if (!o) setPicker(null); }}>
        {/* eyebrow: what, where, columns */}
        <div className="ledger-eyebrow">
          <PopoverAnchor asChild>
            <span className="ledger-anchor">
              <button className="ledger-eyebrow-link" onClick={() => setPicker("type")} title="Change what to look for">{typeLabel}</button>
            </span>
          </PopoverAnchor>
          <span className="ledger-eyebrow-sep">in</span>
          <button className="ledger-eyebrow-link is-strong" onClick={() => setPicker("location")} title="Change where to look">{locationLabel}</button>
          <span className="ledger-eyebrow-sep">·</span>
          <button className="ledger-eyebrow-link" onClick={() => setPicker("columns")} title="Choose columns">{req.attributes.length} column{req.attributes.length === 1 ? "" : "s"}</button>
        </div>

        {/* the where line */}
        <div className="ledger-where">
          {conditions.length === 0 ? (
            <button className="ledger-where-add" onClick={() => setPicker("filters")}>add a condition</button>
          ) : (
            <>
              <span className="ledger-where-word">where</span>
              {conditions.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && <span className="ledger-where-word">{req.matchOp === "or" ? "or" : "and"}</span>}
                  <button className="ledger-where-frag" onClick={() => setPicker("filters")} title="Edit conditions">{describeCondition(c)}</button>
                </span>
              ))}
              <button className="ledger-where-add" onClick={() => setPicker("filters")}>+ condition</button>
            </>
          )}
        </div>

        {/* the search rule */}
        <div className="ledger-rule-field">
          <Search size={14} className="text-ink-3 shrink-0" />
          <input
            value={req.search ?? ""}
            onChange={(e) => setReq({ ...req, search: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") onRun(); if (e.key === "Escape" && req.search) setReq({ ...req, search: "" }); }}
            placeholder="Name, email or username"
            aria-label="Search"
          />
          {req.search ? <button className="ledger-icon" onClick={() => setReq({ ...req, search: "" })} aria-label="clear search"><X size={13} /></button> : <span className="ledger-rule-hint mono">Enter to run</span>}
          <button className="ledger-run" onClick={onRun} disabled={running || !req.baseDN}>
            {running ? <Loader2 size={13} className="animate-spin" /> : null}{running ? "Running" : "Run"}
          </button>
        </div>

        {/* meta line */}
        {result && (
          <div className="ledger-meta">
            <span><b>{result.count.toLocaleString()}</b> {typeLabel.toLowerCase()}{result.truncated ? <span className="ledger-flag warn" title="The directory returned only part of the matches. Narrow the query to see the rest."> partial</span> : null}</span>
            {result.sortLabel && <span>sorted by {result.sortLabel}</span>}
            {asOf && <span>{result.fromCache ? "cached · " : ""}as of {asOf} · <button className="ledger-link" onClick={onRescan} disabled={running}>rescan</button></span>}
            <span className="flex-1" />
            {signedIn365 && <button className="ledger-link" onClick={onCheck365} disabled={result.count === 0}>Check 365</button>}
            <button className="ledger-link" onClick={onExport} disabled={result.count === 0}>Export CSV</button>
            {naming ? (
              <span className="ledger-inline-name">
                <Input autoFocus className="h-7 w-40 font-mono" value={name} placeholder="name this query" onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") confirmSave(); if (e.key === "Escape") setNaming(false); }} onBlur={confirmSave} />
              </span>
            ) : (
              <button className="ledger-link" onClick={() => setNaming(true)}>Save</button>
            )}
          </div>
        )}

        <PopoverContent align="start" className={picker === "filters" ? "w-[560px]" : picker === "columns" ? "w-[360px]" : "w-[320px] p-0"} onOpenAutoFocus={(e) => { if (picker !== "columns") e.preventDefault(); }}>
          {picker === "type" && (
            <div className="py-1">
              <div className="eyebrow px-3 py-2 border-b border-line">What to look for</div>
              {OBJECT_TYPES.map((t) => (
                <button key={t.key} onClick={() => applyType(t.key)} className={"flex items-center w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-sunken " + (activeType === t.key ? "text-brand" : "")}>
                  <span className="flex-1">{t.label}</span>{activeType === t.key && <Check size={13} />}
                </button>
              ))}
            </div>
          )}
          {picker === "location" && (
            <>
              <div className="eyebrow px-3 py-2 border-b border-line">Where to look</div>
              <div className="max-h-56 overflow-auto py-1">
                {locs.map((l) => (
                  <button key={l.dn} onClick={() => setReq({ ...req, baseDN: l.dn, scope: 2 })}
                    className={"flex items-center gap-1.5 w-full text-left py-1.5 pr-3 text-[12.5px] hover:bg-sunken " + (req.baseDN === l.dn ? "text-brand" : "")}
                    style={{ paddingLeft: 12 + l.depth * 14 }}>
                    {l.depth > 0 && <span className="text-ink-3">↳</span>}
                    <span className="truncate">{l.label}</span>
                    {req.baseDN === l.dn && <Check size={13} className="ml-auto shrink-0" />}
                  </button>
                ))}
              </div>
              <div className="border-t border-line px-3 py-2.5 space-y-2.5">
                <div>
                  <div className="eyebrow text-ink-3 mb-1.5">Depth</div>
                  <ToggleGroup type="single" size="sm" variant="outline" value={String(req.scope)} onValueChange={(v) => v && setReq({ ...req, scope: Number(v) })} className="w-full">
                    <ToggleGroupItem value="2" className="flex-1">Everything below</ToggleGroupItem>
                    <ToggleGroupItem value="1" className="flex-1">One level down</ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <div>
                  <div className="eyebrow text-ink-3 mb-1.5">Exact path (DN)</div>
                  <Input className="font-mono h-8" value={req.baseDN} onChange={(e) => setReq({ ...req, baseDN: e.target.value })} placeholder="dc=example,dc=com" />
                </div>
              </div>
            </>
          )}
          {picker === "filters" && (
            <>
              <Tabs value={filterMode} onValueChange={(v) => setFilterMode(v as "visual" | "raw")}>
                <TabsList><TabsTrigger value="visual">Conditions</TabsTrigger><TabsTrigger value="raw">Raw LDAP</TabsTrigger></TabsList>
              </Tabs>
              <div className="mt-3">
                {filterMode === "raw" ? (
                  <>
                    <Input className="font-mono" value={req.filter} onChange={(e) => setReq({ ...req, filter: e.target.value })} placeholder="(objectClass=*)" />
                    <div className="flex items-center gap-2 text-[11.5px] mt-3 pt-2.5 border-t border-line">
                      <span className="eyebrow">Effective</span>
                      <code className="truncate selectable font-mono text-ink-2" title={effectiveFilter(req)}>{effectiveFilter(req) || "(objectClass=*)"}</code>
                    </div>
                  </>
                ) : (
                  <FilterBuilder conditions={req.conditions} matchOp={req.matchOp} attributes={attrSource} onChange={(conditions, matchOp) => setReq({ ...req, conditions, matchOp })} />
                )}
              </div>
              <p className="text-[11px] mt-3 pt-2.5 border-t border-line text-ink-3">Conditions narrow what matches. Where to look is the place in the eyebrow above.</p>
            </>
          )}
          {picker === "columns" && (
            <>
              <div className="eyebrow mb-1.5">Showing {req.attributes.length} columns</div>
              <div className="flex flex-wrap gap-1.5 mb-2.5 max-h-24 overflow-auto">
                {req.attributes.length === 0 && <span className="text-[12px] text-ink-3">None yet. Pick some below.</span>}
                {req.attributes.map((a) => (
                  <span key={a} className="ledger-chip" title={a}>{labelFor(a)}<button className="opacity-50 hover:opacity-100" onClick={() => toggleAttr(a)} aria-label={`remove ${labelFor(a)}`}><X size={11} /></button></span>
                ))}
              </div>
              <Input className="h-8 mb-2" placeholder="Search columns (e.g. phone, last sign-in)" value={newAttr} onChange={(e) => setNewAttr(e.target.value)} />
              <div className="max-h-52 overflow-auto -mx-1 px-1">
                <div className="eyebrow text-ink-3 px-1 mb-1">{newAttr.trim() ? "Matches" : "Common columns"}</div>
                {(newAttr.trim() ? colMatches : commonAvailable).map((a) => (
                  <label key={a} className="flex items-center gap-2.5 py-1 px-1.5 rounded-md hover:bg-sunken cursor-pointer">
                    <Checkbox checked={req.attributes.includes(a)} onCheckedChange={() => toggleAttr(a)} />
                    <span className="flex-1 text-[12.5px]">{labelFor(a)}</span>
                    <span className="text-[10.5px] text-ink-3 font-mono">{a}</span>
                  </label>
                ))}
                {newAttr.trim() && colMatches.length === 0 && (
                  <div className="text-[12px] text-ink-3 px-1 py-2">
                    No columns match “{newAttr.trim()}”. <button className="text-brand hover:underline" onClick={() => { toggleAttr(newAttr.trim()); setNewAttr(""); }}>Add it anyway</button>
                  </div>
                )}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
