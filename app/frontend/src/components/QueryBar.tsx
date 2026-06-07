import { lazy, Suspense, useMemo, useState } from "react";
import { Play, X, Plus, Loader2, SlidersHorizontal, Columns3, Bookmark, ChevronDown, Upload, FileBarChart, Search, Wrench } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

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
  function toggleAttr(name: string) { req.attributes.includes(name) ? removeAttr(name) : addAttr(name); }
  function run() { setPanel(null); onRun(); }

  // Common columns the connected directory actually has (case-insensitive
  // against the live schema; falls back to the full curated list).
  const schemaLower = useMemo(() => new Set((schemaAttributes ?? []).map((a) => a.toLowerCase())), [schemaAttributes]);
  const commonAvailable = useMemo(
    () => schemaLower.size ? COMMON_COLUMNS.filter((a) => schemaLower.has(a.toLowerCase())) : COMMON_COLUMNS,
    [schemaLower],
  );

  const suggestions = useMemo(
    () => attrSource.filter((a) => !req.attributes.includes(a) && a.toLowerCase().includes(debouncedAttr.toLowerCase())).slice(0, 8),
    [attrSource, req.attributes, debouncedAttr]
  );

  function toggle(p: Panel) { setPanel((cur) => (cur === p ? null : p)); }

  return (
    <div className="relative px-4 py-2.5 bg-surface border-b border-line">
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className={panel === "saved" ? "bg-sunken" : ""}><Wrench size={14} /> Tools <ChevronDown size={12} /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => toggle("saved")}><Bookmark size={14} /> Saved queries</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { setPanel(null); setShowImport(true); }}><Upload size={14} /> Bulk lookup (CSV / Excel)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { setPanel(null); setShowReports(true); }}><FileBarChart size={14} /> Reports</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

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

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="eyebrow shrink-0">in</span>
          <Select value={req.baseDN} onValueChange={(val) => setReq({ ...req, baseDN: val, scope: 2 })}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Location" /></SelectTrigger>
            <SelectContent>
            {locs.map((l) => (
              <SelectItem key={l.dn} value={l.dn}>{" ".repeat(l.depth) + (l.depth > 0 ? "↳ " : "") + l.label}</SelectItem>
            ))}
            </SelectContent>
          </Select>
        </div>

        <Button variant="outline" className={(panel === "filters" ? "bg-sunken" : "")} onClick={() => toggle("filters")}>
          <SlidersHorizontal size={14} /> Filters{activeConditions > 0 ? <span className="ml-0.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[10px] font-semibold bg-brand text-white">{activeConditions}</span> : null}
        </Button>

        <Button variant="outline" className={(panel === "columns" ? "bg-sunken" : "")} onClick={() => toggle("columns")}>
          <Columns3 size={14} /> Columns <span className="text-ink-3">{req.attributes.length}</span> <ChevronDown size={12} />
        </Button>

        <Button className="px-5" onClick={run} disabled={running || !req.baseDN}>
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={13} />}{running ? "Running" : "Run"}
        </Button>
      </div>

      {panel && <div className="fixed inset-0 z-20" onClick={() => setPanel(null)} />}

      {panel === "saved" && (
        <Pop className="left-4 w-[300px]"><SavedQueriesBar current={req} onLoad={(q) => { setReq(q); setPanel(null); }} /></Pop>
      )}

      {panel === "filters" && (
        <Pop className="right-4 w-[540px]">
          <Tabs value={filterMode} onValueChange={(v) => setFilterMode(v as any)}>
            <TabsList>
              <TabsTrigger value="visual">Filter builder</TabsTrigger>
              <TabsTrigger value="raw">Raw LDAP</TabsTrigger>
            </TabsList>
          </Tabs>
          {filterMode === "raw" ? (
            <Input className="font-mono" value={req.filter} onChange={(e) => setReq({ ...req, filter: e.target.value })} placeholder="(objectClass=*)" />
          ) : (
            <FilterBuilder conditions={req.conditions} matchOp={req.matchOp} attributes={attrSource} onChange={(conditions, matchOp) => setReq({ ...req, conditions, matchOp })} />
          )}
          <div className="flex items-center gap-2 text-[11.5px] mt-3 pt-2.5 border-t border-line">
            <span className="eyebrow">Effective</span>
            <code className="truncate selectable font-mono text-ink-2" title={effectiveFilter(req)}>{effectiveFilter(req) || "(objectClass=*)"}</code>
          </div>

          {/* Location & scope — the raw base DN + search depth (one level deep). */}
          <div className="mt-3 pt-2.5 border-t border-line">
            <div className="eyebrow text-ink-3 mb-2">Location &amp; scope</div>
            <div className="grid grid-cols-3 gap-2">
              <Input className="font-mono col-span-2 h-8" value={req.baseDN} onChange={(e) => setReq({ ...req, baseDN: e.target.value })} placeholder="base dn" />
              <Select value={String(req.scope)} onValueChange={(val) => setReq({ ...req, scope: Number(val) })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Base</SelectItem>
                  <SelectItem value="1">One level</SelectItem>
                  <SelectItem value="2">Subtree</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Pop>
      )}

      {panel === "columns" && (
        <Pop className="right-4 w-[340px]">
          <div className="eyebrow mb-1.5">Showing {req.attributes.length} columns</div>
          {/* What's currently shown — friendly names, click ✕ to remove. */}
          <div className="flex flex-wrap gap-1.5 mb-3 max-h-24 overflow-auto">
            {req.attributes.length === 0 && <span className="text-[12px] text-ink-3">None — pick some below.</span>}
            {req.attributes.map((a) => (
              <Badge variant="secondary" key={a} className="font-normal" title={a}>{labelFor(a)}<button className="opacity-50 hover:opacity-100" onClick={() => removeAttr(a)} aria-label={`remove ${labelFor(a)}`}><X size={11} /></button></Badge>
            ))}
          </div>

          {/* Pick from common columns — no need to know attribute names. */}
          <div className="eyebrow text-ink-3 mb-1">Common columns</div>
          <div className="max-h-52 overflow-auto -mx-1 px-1">
            {commonAvailable.map((a) => (
              <label key={a} className="flex items-center gap-2.5 py-1 px-1.5 rounded-md hover:bg-sunken cursor-pointer">
                <Checkbox checked={req.attributes.includes(a)} onCheckedChange={() => toggleAttr(a)} />
                <span className="flex-1 text-[12.5px]">{labelFor(a)}</span>
                <span className="text-[10.5px] text-ink-3 font-mono">{a}</span>
              </label>
            ))}
          </div>

          {/* Advanced — type any of the directory's attributes by name. */}
          <details className="mt-3 pt-2.5 border-t border-line">
            <summary className="eyebrow cursor-pointer select-none text-ink-3">Add any attribute{schemaAttributes && schemaAttributes.length > 0 ? ` · ${schemaAttributes.length} in schema` : ""}</summary>
            <div className="relative mt-2">
              <div className="flex items-center gap-1">
                <Input className="font-mono h-8" value={newAttr} onChange={(e) => setNewAttr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addAttr(newAttr)} placeholder="attribute name…" />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => addAttr(newAttr)} aria-label="add"><Plus size={14} /></Button>
              </div>
              {newAttr && suggestions.length > 0 && (
                <div className="mt-1 max-h-44 overflow-auto rounded-[10px] border border-line">
                  {suggestions.map((s) => (
                    <button key={s} className="flex w-full items-center justify-between gap-2 text-left px-2.5 py-1.5 text-[12px] hover:bg-sunken" onClick={() => addAttr(s)}>
                      <span>{labelFor(s)}</span><span className="text-[10.5px] text-ink-3 font-mono">{s}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </details>
        </Pop>
      )}

      {showImport && <Suspense fallback={null}><BulkImportDialog req={req} onClose={() => setShowImport(false)} /></Suspense>}
      {showReports && <Suspense fallback={null}><ReportsPanel req={req} isAD={isAD} onOpen={(q) => { onOpenReport?.(q); setShowReports(false); }} resultIdentities={resultIdentities ?? []} onClose={() => setShowReports(false)} /></Suspense>}
    </div>
  );
}

function Pop({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={"absolute top-full z-30 mt-1 p-3 rounded-xl border border-line bg-surface shadow-xl " + (className ?? "")} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}
