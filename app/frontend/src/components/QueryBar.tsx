import { lazy, Suspense, useMemo, useState } from "react";
import { Play, X, Plus, Loader2, SlidersHorizontal, Columns3, Bookmark, ChevronDown, Upload, Cloud, FileBarChart } from "lucide-react";
import { OBJECT_TYPES, filterFor, COMMON_ATTRIBUTES } from "../lib/objectTypes";
import { FilterBuilder } from "./FilterBuilder";
import { SavedQueriesBar } from "./SavedQueriesBar";

// Lazy — pulls in SheetJS only when the user opens bulk lookup.
const BulkImportDialog = lazy(() => import("./BulkImportDialog").then((m) => ({ default: m.BulkImportDialog })));
const M365Dialog = lazy(() => import("./M365Dialog").then((m) => ({ default: m.M365Dialog })));
const ReportsPanel = lazy(() => import("./ReportsPanel").then((m) => ({ default: m.ReportsPanel })));
import { Condition, MatchOp, compileConditions, combineAnd, isConditionValid } from "../lib/filterBuilder";
import { useDebouncedValue } from "../lib/hooks";

export interface QueryState {
  baseDN: string;
  scope: number;
  filter: string;
  attributes: string[];
  conditions: Condition[];
  matchOp: MatchOp;
}

export function effectiveFilter(req: QueryState): string {
  return combineAnd(req.filter, compileConditions(req.conditions, req.matchOp));
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
  const [show365, setShow365] = useState(false);
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
    if (t) setReq({ ...req, filter: filterFor(t, isAD), attributes: [...t.defaultAttributes] });
  }
  function addAttr(name: string) {
    const a = name.trim();
    if (!a || req.attributes.includes(a)) return;
    setReq({ ...req, attributes: [...req.attributes, a] });
    setNewAttr("");
  }
  function removeAttr(name: string) { setReq({ ...req, attributes: req.attributes.filter((x) => x !== name) }); }
  function run() { setPanel(null); onRun(); }

  const suggestions = useMemo(
    () => attrSource.filter((a) => !req.attributes.includes(a) && a.toLowerCase().includes(debouncedAttr.toLowerCase())).slice(0, 8),
    [attrSource, req.attributes, debouncedAttr]
  );

  function toggle(p: Panel) { setPanel((cur) => (cur === p ? null : p)); }

  return (
    <div className="relative px-4 py-2.5" style={{ background: "var(--color-card)", borderBottom: "1px solid var(--color-line)" }}>
      <div className="flex items-center gap-2">
        <button className={"btn btn-quiet btn-icon " + (panel === "saved" ? "bg-[var(--color-sunken)]" : "")} title="Saved queries" onClick={() => toggle("saved")}>
          <Bookmark size={15} />
        </button>
        <button className="btn btn-quiet btn-icon" title="Bulk lookup from file (CSV / Excel)" onClick={() => { setPanel(null); setShowImport(true); }}>
          <Upload size={15} />
        </button>
        <button className="btn btn-quiet btn-icon" title="Microsoft 365 / Entra sign-in" onClick={() => { setPanel(null); setShow365(true); }}>
          <Cloud size={15} />
        </button>
        <button className="btn btn-quiet btn-icon" title="Reports" onClick={() => { setPanel(null); setShowReports(true); }}>
          <FileBarChart size={15} />
        </button>

        <div className="seg">
          {OBJECT_TYPES.map((t) => (
            <button key={t.key} data-active={activeType === t.key} onClick={() => applyType(t.key)}>{t.label}</button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
          <span className="eyebrow shrink-0">Search in</span>
          <select className="input flex-1" value={req.baseDN} onChange={(e) => setReq({ ...req, baseDN: e.target.value, scope: 2 })} title="Location">
            {locs.map((l) => (
              <option key={l.dn} value={l.dn}>{" ".repeat(l.depth) + (l.depth > 0 ? "↳ " : "") + l.label}</option>
            ))}
          </select>
        </div>

        <button className={"btn " + (panel === "filters" ? "bg-[var(--color-sunken)]" : "")} onClick={() => toggle("filters")}>
          <SlidersHorizontal size={14} /> Filters{activeConditions > 0 ? <span className="ml-0.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[10px] font-semibold" style={{ background: "var(--color-accent)", color: "#fff" }}>{activeConditions}</span> : null}
        </button>

        <button className={"btn " + (panel === "columns" ? "bg-[var(--color-sunken)]" : "")} onClick={() => toggle("columns")}>
          <Columns3 size={14} /> Columns <span style={{ color: "var(--color-ink-3)" }}>{req.attributes.length}</span> <ChevronDown size={12} />
        </button>

        <button className="btn btn-primary px-5" onClick={run} disabled={running || !req.baseDN}>
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={13} />}{running ? "Running" : "Run"}
        </button>
      </div>

      {panel && <div className="fixed inset-0 z-20" onClick={() => setPanel(null)} />}

      {panel === "saved" && (
        <Pop className="left-4 w-[300px]"><SavedQueriesBar current={req} onLoad={(q) => { setReq(q); setPanel(null); }} /></Pop>
      )}

      {panel === "filters" && (
        <Pop className="right-4 w-[540px]">
          <div className="tabs gap-4 mb-3" style={{ borderBottom: "1px solid var(--color-line)" }}>
            <button className="tab" data-active={filterMode === "visual"} onClick={() => setFilterMode("visual")}>Filter builder</button>
            <button className="tab" data-active={filterMode === "raw"} onClick={() => setFilterMode("raw")}>Raw LDAP</button>
          </div>
          {filterMode === "raw" ? (
            <input className="input mono" value={req.filter} onChange={(e) => setReq({ ...req, filter: e.target.value })} placeholder="(objectClass=*)" />
          ) : (
            <FilterBuilder conditions={req.conditions} matchOp={req.matchOp} attributes={attrSource} onChange={(conditions, matchOp) => setReq({ ...req, conditions, matchOp })} />
          )}
          <div className="flex items-center gap-2 text-[11.5px] mt-3 pt-2.5" style={{ borderTop: "1px solid var(--color-line)" }}>
            <span className="eyebrow">Effective</span>
            <code className="truncate selectable" style={{ fontFamily: "var(--font-mono)", color: "var(--color-ink-2)" }} title={effectiveFilter(req)}>{effectiveFilter(req) || "(objectClass=*)"}</code>
          </div>

          {/* Advanced — for the rare power user who really wants a raw DN + scope. */}
          <details className="mt-3 pt-2.5" style={{ borderTop: "1px solid var(--color-line)" }}>
            <summary className="eyebrow cursor-pointer select-none" style={{ color: "var(--color-ink-3)" }}>Advanced · base DN &amp; scope</summary>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <input className="input mono col-span-2 h-8" value={req.baseDN} onChange={(e) => setReq({ ...req, baseDN: e.target.value })} placeholder="base dn" />
              <select className="input h-8" value={req.scope} onChange={(e) => setReq({ ...req, scope: Number(e.target.value) })}>
                <option value={0}>Base</option>
                <option value={1}>One level</option>
                <option value={2}>Subtree</option>
              </select>
            </div>
          </details>
        </Pop>
      )}

      {panel === "columns" && (
        <Pop className="right-4 w-[320px]">
          <div className="eyebrow mb-2">Columns · {req.attributes.length}</div>
          <div className="flex flex-wrap gap-1.5 mb-2.5 max-h-32 overflow-auto">
            {req.attributes.map((a) => (
              <span key={a} className="token">{a}<button className="opacity-50 hover:opacity-100" onClick={() => removeAttr(a)} aria-label={`remove ${a}`}><X size={11} /></button></span>
            ))}
          </div>
          <div className="relative">
            <div className="flex items-center gap-1">
              <input className="input mono h-8" value={newAttr} onChange={(e) => setNewAttr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addAttr(newAttr)} placeholder="add attribute…" />
              <button className="btn btn-quiet btn-icon h-8 w-8" onClick={() => addAttr(newAttr)} aria-label="add"><Plus size={14} /></button>
            </div>
            {newAttr && suggestions.length > 0 && (
              <div className="mt-1 max-h-44 overflow-auto" style={{ border: "1px solid var(--color-line)", borderRadius: 10 }}>
                {suggestions.map((s) => (
                  <button key={s} className="block w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-[var(--color-sunken)]" style={{ fontFamily: "var(--font-mono)" }} onClick={() => addAttr(s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
          {schemaAttributes && schemaAttributes.length > 0 && <p className="text-[11px] mt-2" style={{ color: "var(--color-ink-3)" }}>{schemaAttributes.length} attributes in schema</p>}
        </Pop>
      )}

      {showImport && <Suspense fallback={null}><BulkImportDialog req={req} onClose={() => setShowImport(false)} /></Suspense>}
      {show365 && <Suspense fallback={null}><M365Dialog onClose={() => setShow365(false)} /></Suspense>}
      {showReports && <Suspense fallback={null}><ReportsPanel req={req} isAD={isAD} onOpen={(q) => { onOpenReport?.(q); setShowReports(false); }} resultIdentities={resultIdentities ?? []} onClose={() => setShowReports(false)} /></Suspense>}
    </div>
  );
}

function Pop({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={"absolute z-30 mt-1 card p-3 " + (className ?? "")} style={{ top: "100%", boxShadow: "0 10px 32px rgba(20,18,12,0.16)" }} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}
