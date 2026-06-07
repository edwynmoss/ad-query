import { lazy, Suspense, useMemo, useState } from "react";
import { Play, X, Loader2, SlidersHorizontal, Columns3, Bookmark, ChevronDown, Upload, FileBarChart, Search, Wrench, MapPin, Check } from "lucide-react";
import { OBJECT_TYPES, filterFor, defaultAttributesFor, COMMON_ATTRIBUTES } from "../lib/objectTypes";
import { labelFor, COMMON_COLUMNS } from "../lib/attrLabels";
import { Checkbox } from "@/components/ui/checkbox";
import { FilterBuilder } from "./FilterBuilder";
import { SavedQueriesBar } from "./SavedQueriesBar";

// Lazy — pulls in SheetJS only when the user opens bulk lookup.
const BulkImportDialog = lazy(() => import("./BulkImportDialog").then((m) => ({ default: m.BulkImportDialog })));
const ReportsPanel = lazy(() => import("./ReportsPanel").then((m) => ({ default: m.ReportsPanel })));
import { Condition, MatchOp, compileConditions, combineAnd, quickSearchFilter, isConditionValid } from "../lib/filterBuilder";
import { useDebouncedValue } from "../lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from "@/components/ui/popover";

export interface QueryState {
  baseDN: string;
  scope: number;
  filter: string;
  attributes: string[];
  conditions: Condition[];
  matchOp: MatchOp;
  search?: string;   // plain-language quick search across identity fields
}

export function effectiveFilter(req: QueryState): string {
  return combineAnd(combineAnd(req.filter, quickSearchFilter(req.search ?? "")), compileConditions(req.conditions, req.matchOp));
}

// A directory location the user can pick by name (mapped to a base DN behind
// the scenes — nobody should have to type a distinguished name).
export interface DirLocation {
  dn: string;
  label: string;
  depth: number;
}

interface Props {
  req: QueryState;
  setReq: (r: QueryState) => void;
  isAD: boolean;
  running: boolean;
  onRun: () => void;
  onOpenReport?: (q: QueryState) => void;
  resultIdentities?: string[];
  schemaAttributes?: string[];
  locations?: DirLocation[];
}

type Panel = null | "filters" | "columns" | "saved";

export function QueryBar({ req, setReq, isAD, running, onRun, onOpenReport, resultIdentities, schemaAttributes, locations }: Props) {
  const [panel, setPanel] = useState<Panel>(null);
  const [showImport, setShowImport] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [filterMode, setFilterMode] = useState<"visual" | "raw">("visual");
  const [newAttr, setNewAttr] = useState("");
  const debouncedAttr = useDebouncedValue(newAttr, 100);

  const activeType = OBJECT_TYPES.find((t) => filterFor(t, isAD) === req.filter)?.key ?? "";
  const attrSource = schemaAttributes && schemaAttributes.length > 0 ? schemaAttributes : COMMON_ATTRIBUTES;
  const activeConditions = req.conditions.filter(isConditionValid).length;

  // Location options for "Search in" — always include the current base DN so a
  // custom/advanced DN still shows a sensible selection.
  const locs = useMemo<DirLocation[]>(() => {
    const list: DirLocation[] = locations && locations.length ? [...locations] : req.baseDN ? [{ dn: req.baseDN, label: "Entire directory", depth: 0 }] : [];
    if (req.baseDN && !list.some((l) => l.dn === req.baseDN)) list.unshift({ dn: req.baseDN, label: "Custom location", depth: 0 });
    return list;
  }, [locations, req.baseDN]);

  function applyType(key: string) {
    const t = OBJECT_TYPES.find((x) => x.key === key);
    if (t) setReq({ ...req, filter: filterFor(t, isAD), attributes: defaultAttributesFor(t, isAD) });
  }
  function addAttr(name: string) {
    const a = name.trim();
    if (!a || req.attributes.includes(a)) return;
    setReq({ ...req, attributes: [...req.attributes, a] });
    setNewAttr("");
  }
  function removeAttr(name: string) { setReq({ ...req, attributes: req.attributes.filter((x) => x !== name) }); }
  // Self-contained so toggling from the checklist doesn't clear the search box.
  function toggleAttr(name: string) {
    setReq(req.attributes.includes(name)
      ? { ...req, attributes: req.attributes.filter((x) => x !== name) }
      : { ...req, attributes: [...req.attributes, name] });
  }
  function run() { setPanel(null); onRun(); }

  // Common columns the connected directory actually has (case-insensitive
  // against the live schema; falls back to the full curated list).
  const schemaLower = useMemo(() => new Set((schemaAttributes ?? []).map((a) => a.toLowerCase())), [schemaAttributes]);
  const commonAvailable = useMemo(
    () => schemaLower.size ? COMMON_COLUMNS.filter((a) => schemaLower.has(a.toLowerCase())) : COMMON_COLUMNS,
    [schemaLower],
  );

  // Column search: matches on the friendly label OR the raw attribute name,
  // ranking common columns first, across everything the directory has.
  const colMatches = useMemo(() => {
    const q = debouncedAttr.trim().toLowerCase();
    if (!q) return [];
    const ranked = [...commonAvailable, ...attrSource];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const a of ranked) {
      const lc = a.toLowerCase();
      if (seen.has(lc)) continue;
      seen.add(lc);
      if (lc.includes(q) || labelFor(a).toLowerCase().includes(q)) out.push(a);
      if (out.length >= 60) break;
    }
    return out;
  }, [debouncedAttr, attrSource, commonAvailable]);

  function toggle(p: Panel) { setPanel((cur) => (cur === p ? null : p)); }

  const locationLabel = locs.find((l) => l.dn === req.baseDN)?.label ?? (req.baseDN ? "Custom location" : "Location");

  return (
    <div className="relative px-4 py-2.5 bg-surface border-b border-line">
      <div className="flex items-center gap-2">
        {/* Tools menu; the Saved-queries panel opens as a Popover anchored here. */}
        <Popover open={panel === "saved"} onOpenChange={(o) => { if (!o) setPanel(null); }}>
          {/* One Button is both the dropdown trigger and the popover anchor:
              both asChild Slots compose their props + ref onto it (Button is
              forwardRef). Anchoring to a real element — not the DropdownMenu
              root — avoids "function components cannot be given refs". */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <PopoverAnchor asChild>
                <Button variant="outline" className={panel === "saved" ? "bg-sunken" : ""}><Wrench size={14} /> Tools <ChevronDown size={12} /></Button>
              </PopoverAnchor>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => toggle("saved")}><Bookmark size={14} /> Saved queries</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setPanel(null); setShowImport(true); }}><Upload size={14} /> Bulk lookup (CSV / Excel)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setPanel(null); setShowReports(true); }}><FileBarChart size={14} /> Reports</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <PopoverContent align="start" className="w-[300px]">
            <SavedQueriesBar current={req} onLoad={(q) => { setReq(q); setPanel(null); }} />
          </PopoverContent>
        </Popover>

        <ToggleGroup type="single" variant="outline" value={activeType} onValueChange={(v) => v && applyType(v)}>
          {OBJECT_TYPES.map((t) => (
            <ToggleGroupItem key={t.key} value={t.key}>{t.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
          <Input
            className="pl-8 pr-8"
            placeholder="Search name, email, or username…"
            value={req.search ?? ""}
            onChange={(e) => setReq({ ...req, search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
              if (e.key === "Escape" && req.search) { setReq({ ...req, search: "" }); }
            }}
          />
          {req.search ? (
            <button
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink"
              onClick={() => setReq({ ...req, search: "" })}
              aria-label="clear search"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        {/* Where to search — one picker owns location + depth + custom path. */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="shrink-0 max-w-[220px]" title="Where to search">
              <MapPin size={14} /> <span className="truncate">{locationLabel}</span> <ChevronDown size={12} />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[320px] p-0">
            <div className="eyebrow px-3 py-2 border-b border-line">Search in</div>
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
          </PopoverContent>
        </Popover>

        <Popover open={panel === "filters"} onOpenChange={(o) => setPanel(o ? "filters" : null)}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={(panel === "filters" ? "bg-sunken" : "")}>
              <SlidersHorizontal size={14} /> Filters{activeConditions > 0 ? <span className="ml-0.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[10px] font-semibold bg-brand text-white">{activeConditions}</span> : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[540px]">
            <Tabs value={filterMode} onValueChange={(v) => setFilterMode(v as any)}>
              <TabsList>
                <TabsTrigger value="visual">Filter builder</TabsTrigger>
                <TabsTrigger value="raw">Raw LDAP</TabsTrigger>
              </TabsList>
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
            <p className="text-[11px] mt-3 pt-2.5 border-t border-line text-ink-3">Conditions narrow <em>what</em> matches. Choose <em>where</em> to search with the location picker (<MapPin size={11} className="inline -mt-0.5" />) in the bar.</p>
          </PopoverContent>
        </Popover>

        <Popover open={panel === "columns"} onOpenChange={(o) => setPanel(o ? "columns" : null)}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={(panel === "columns" ? "bg-sunken" : "")}>
              <Columns3 size={14} /> Columns <span className="text-ink-3">{req.attributes.length}</span> <ChevronDown size={12} />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[340px]">
            <div className="eyebrow mb-1.5">Showing {req.attributes.length} columns</div>
            <div className="flex flex-wrap gap-1.5 mb-2.5 max-h-24 overflow-auto">
              {req.attributes.length === 0 && <span className="text-[12px] text-ink-3">None — pick some below.</span>}
              {req.attributes.map((a) => (
                <Badge variant="secondary" key={a} className="font-normal" title={a}>{labelFor(a)}<button className="opacity-50 hover:opacity-100" onClick={() => removeAttr(a)} aria-label={`remove ${labelFor(a)}`}><X size={11} /></button></Badge>
              ))}
            </div>
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
              <Input className="pl-8 h-8" placeholder="Search columns (e.g. phone, last sign-in)…" value={newAttr} onChange={(e) => setNewAttr(e.target.value)} />
            </div>
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
                  No columns match “{newAttr.trim()}”.{" "}
                  <button className="text-brand hover:underline" onClick={() => addAttr(newAttr)}>Add “{newAttr.trim()}” anyway</button>
                </div>
              )}
            </div>
            <p className="text-[11px] mt-2 pt-2 border-t border-line text-ink-3">
              {newAttr.trim()
                ? `${colMatches.length} match${colMatches.length === 1 ? "" : "es"}`
                : schemaAttributes && schemaAttributes.length > 0
                  ? `${commonAvailable.length} common · ${schemaAttributes.length} total — type to search all`
                  : "Type to search all attributes"}
            </p>
          </PopoverContent>
        </Popover>

        <Button className="px-5" onClick={run} disabled={running || !req.baseDN}>
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={13} />}{running ? "Running" : "Run"}
        </Button>
      </div>

      {showImport && <Suspense fallback={null}><BulkImportDialog req={req} onClose={() => setShowImport(false)} /></Suspense>}
      {showReports && <Suspense fallback={null}><ReportsPanel req={req} isAD={isAD} onOpen={(q) => { onOpenReport?.(q); setShowReports(false); }} resultIdentities={resultIdentities ?? []} onClose={() => setShowReports(false)} /></Suspense>}
    </div>
  );
}
