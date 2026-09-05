import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBanner } from "@/components/ui/error-banner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Disconnect, Search, SearchCached, SchemaAttributes, M365SignedIn, M365Account, M365Check, ClearCache } from "../wailsjs/go/main/App";
import { ldap } from "../wailsjs/go/models";
import { License365Dialog } from "./components/License365Dialog";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { QueryState, effectiveFilter, DirLocation } from "./components/QueryBar";
import { QueryHeading, type Picker } from "./components/QueryHeading";
import { OpeningSheet } from "./components/OpeningSheet";
import { Registers, type RegisterKey } from "./components/Registers";
import { LedgerGrid, sortEntries, type SortState } from "./components/LedgerGrid";
import { SidePane, type PaneMode } from "./components/SidePane";
import { ExportDialog } from "./components/ExportDialog";
import { getTheme, applyTheme, Theme } from "./lib/theme";
import { Mark } from "./components/Mark";
import { appVersion, scheduleUpdateChecks, offerUpdate } from "./lib/updates";
import { rememberQuery } from "./lib/recentQueries";
import { loadSavedQueries, deleteSavedQuery, type SavedQuery } from "./lib/savedQueries";
import { describeQuery, describeType, describeLocation } from "./lib/describe";
import { BUILTIN_REPORTS, resolveQuery } from "./lib/reports";
import { newCondition } from "./lib/filterBuilder";
import { labelFor } from "./lib/attrLabels";

const M365Dialog = lazy(() => import("./components/M365Dialog").then((m) => ({ default: m.M365Dialog })));
const StaleRegister = lazy(() => import("./components/registers/StaleRegister").then((m) => ({ default: m.StaleRegister })));
const PrivilegedRegister = lazy(() => import("./components/registers/PrivilegedRegister").then((m) => ({ default: m.PrivilegedRegister })));
const LicencesRegister = lazy(() => import("./components/registers/LicencesRegister").then((m) => ({ default: m.LicencesRegister })));
const PoliciesRegister = lazy(() => import("./components/registers/PoliciesRegister").then((m) => ({ default: m.PoliciesRegister })));
const BulkRegister = lazy(() => import("./components/registers/BulkRegister").then((m) => ({ default: m.BulkRegister })));

const LIC_COL = "Microsoft 365 licenses";
const SIGNIN_COL = "365 last sign-in";

function App() {
  const [server, setServer] = useState<ldap.ServerInfo | null>(null);
  const [conn, setConn] = useState<ldap.ConnectOptions | null>(null);
  const [req, setReq] = useState<QueryState>({ baseDN: "", scope: 2, filter: "(objectClass=*)", attributes: ["cn", "objectClass"], conditions: [], matchOp: "and", search: "" });
  const [result, setResult] = useState<ldap.SearchResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ldap.Entry | null>(null);
  const [schema, setSchema] = useState<string[]>([]);
  const [locations, setLocations] = useState<DirLocation[]>([]);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [cacheAt, setCacheAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [show365, setShow365] = useState(false);
  const [m365, setM365] = useState<{ signedIn: boolean; account: string }>({ signedIn: false, account: "" });
  const [show365Filter, setShow365Filter] = useState(false);
  const [busy365, setBusy365] = useState(false);
  const [extra365Cols, setExtra365Cols] = useState<string[]>([]);
  const [version, setVersion] = useState<string>("");

  // Sheet state
  const [register, setRegister] = useState<RegisterKey>("search");
  const [sort, setSort] = useState<SortState | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [factsColumn, setFactsColumn] = useState<string | null>(null);
  const [paneMode, setPaneMode] = useState<PaneMode>("column");
  const [showExport, setShowExport] = useState(false);
  const [saved, setSaved] = useState<SavedQuery[]>(() => loadSavedQueries());
  const [picker, setPicker] = useState<{ kind: Picker; nonce: number } | null>(null);
  const [composing, setComposing] = useState(false); // heading shown before any result, to use a picker

  useEffect(() => {
    appVersion().then(setVersion);
    scheduleUpdateChecks();
  }, []);

  function toggleTheme() { const t = theme === "light" ? "dark" : "light"; applyTheme(t); setTheme(t); }

  async function refreshM365() {
    try {
      const signedIn = await M365SignedIn();
      const account = signedIn ? await M365Account() : "";
      setM365({ signedIn, account });
    } catch { setM365({ signedIn: false, account: "" }); }
  }
  useEffect(() => { if (server) refreshM365(); }, [server]);

  function onConnected(info: ldap.ServerInfo, opts: ldap.ConnectOptions) {
    setServer(info); setConn(opts);
    const root = info.defaultNamingContext || req.baseDN;
    setReq((r) => ({ ...r, baseDN: root }));
    SchemaAttributes().then(setSchema).catch(() => setSchema([]));
    loadLocations(root);
  }

  async function loadLocations(root: string) {
    const base: DirLocation[] = [{ dn: root, label: "Entire directory", depth: 0 }];
    if (!root) { setLocations(base); return; }
    try {
      const res = await Search(ldap.SearchRequest.createFrom({ baseDN: root, scope: 2, filter: "(objectClass=organizationalUnit)", attributes: ["ou", "name"], pageSize: 1000, sizeLimit: 0 }));
      const rootDepth = root.split(",").length;
      const ous = (res.entries ?? []).map((e) => ({
        dn: e.dn,
        label: e.attributes?.ou?.[0] ?? e.attributes?.name?.[0] ?? e.dn.split(",")[0].replace(/^[^=]+=/, ""),
        depth: Math.max(1, e.dn.split(",").length - rootDepth),
        sortKey: e.dn.split(",").reverse().join(",").toLowerCase(),
      }));
      ous.sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
      setLocations([...base, ...ous.map(({ sortKey: _s, ...l }) => l)]);
    } catch {
      setLocations(base);
    }
  }

  async function disconnect() {
    await Disconnect();
    setServer(null); setConn(null); setResult(null); setSelected(null); setSchema([]); setLocations([]); setElapsed(null);
    setRegister("search"); setChecked(new Set()); setSort(null); setFactsColumn(null); setComposing(false); setError(null);
  }

  async function apply365(skus: string[]) {
    if (!result) return;
    setBusy365(true);
    try {
      const entries = result.entries ?? [];
      const ids = Array.from(new Set(entries.map((e) => e.attributes?.userPrincipalName?.[0] || e.attributes?.mail?.[0] || "").filter(Boolean)));
      const users = ids.length ? await M365Check(ids, false) : [];
      const byId = new Map(users.map((u) => [(u.identity || "").toLowerCase(), u]));
      const kept = entries.flatMap((e) => {
        const id = (e.attributes?.userPrincipalName?.[0] || e.attributes?.mail?.[0] || "").toLowerCase();
        const u = id ? byId.get(id) : undefined;
        const licenses = u && u.exists && u.licenses ? u.licenses : [];
        const holds = licenses.length > 0 && (skus.length === 0 || licenses.some((l) => skus.includes(l)));
        if (!holds) return [];
        return [ldap.Entry.createFrom({ dn: e.dn, attributes: { ...e.attributes, [LIC_COL]: [licenses.join(", ")], [SIGNIN_COL]: [u?.lastSignIn || ""] } })];
      });
      setResult(ldap.SearchResult.createFrom({ count: kept.length, truncated: false, entries: kept }));
      setExtra365Cols([LIC_COL, SIGNIN_COL]);
      setSelected(null);
      toast.success(`365 check: ${kept.length} of ${entries.length} hold the selected licence`);
    } catch (e: any) {
      toast.error("365 check failed", { description: String(e?.message ?? e) });
    } finally { setBusy365(false); setShow365Filter(false); }
  }

  async function runQuery(override?: QueryState, refresh = false) {
    const q = override ?? req;
    if (!q.baseDN) return;
    setRunning(true); setError(null); setSelected(null); setExtra365Cols([]); setChecked(new Set());
    setRegister("search"); setPicker(null);
    const t0 = performance.now();
    try {
      const cs = await SearchCached(ldap.SearchRequest.createFrom({ baseDN: q.baseDN, scope: q.scope, filter: effectiveFilter(q), attributes: q.attributes, pageSize: 1000, sizeLimit: 0 }), refresh);
      setResult(cs.result ?? null); setCacheAt(cs.fetchedAt); setFromCache(cs.fromCache); setElapsed(Math.round(performance.now() - t0));
      rememberQuery(q, cs.result?.count ?? 0);
      if (!factsColumn || !q.attributes.includes(factsColumn)) setFactsColumn(q.attributes[0] ?? null);
    } catch (e: any) { setError(String(e?.message ?? e)); setResult(null); setElapsed(null); setCacheAt(null); setFromCache(false); }
    finally { setRunning(false); }
  }

  function openQuery(q: QueryState) { setReq(q); runQuery(q); }

  function openRegister(key: RegisterKey) {
    if (key === "all-users") {
      const r = BUILTIN_REPORTS.find((x) => x.id === "users-all")!;
      openQuery({ ...resolveQuery(r, server?.isActiveDirectory ?? false, req.baseDN), search: "" });
      return;
    }
    setRegister(key); setPicker(null);
  }

  // Column facts: keep or exclude a value by adding a condition and re-running.
  function filterValue(column: string, value: string, exclude: boolean) {
    const c = { ...newCondition(), attribute: column, operator: value === "" ? (exclude ? "present" : "notpresent") : (exclude ? "neq" : "eq"), value } as ReturnType<typeof newCondition>;
    const q: QueryState = { ...req, conditions: [...req.conditions, c], matchOp: "and" };
    openQuery(q);
  }
  function hideColumn(col: string) {
    setReq({ ...req, attributes: req.attributes.filter((a) => a !== col) });
    if (factsColumn === col) setFactsColumn(req.attributes.find((a) => a !== col) ?? null);
  }
  function toggleSort(col: string) { setSort((s) => (s?.col === col ? { col, asc: !s.asc } : { col, asc: true })); }
  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); toast.success("Copied"); } catch { toast.error("Couldn't copy"); }
  }
  function requestPicker(kind: Picker) { setComposing(true); setPicker({ kind, nonce: Date.now() }); }
  function selectRow(e: ldap.Entry) { setSelected(e); setPaneMode("row"); }
  function inspectColumn(col: string) { setFactsColumn(col); setPaneMode("column"); }

  const entries = result?.entries ?? [];
  const sorted = useMemo(() => sortEntries(entries, sort), [entries, sort]);
  const columns = useMemo(() => [...req.attributes, ...extra365Cols], [req.attributes, extra365Cols]);
  const isAD = server?.isActiveDirectory ?? false;

  if (!server) return <ConnectionPanel onConnected={onConnected} />;

  const sortLabel = sort ? `${labelFor(sort.col)}${sort.asc ? "" : ", descending"}` : null;
  const scopeLabel = ["Base", "One level", "Subtree"][req.scope] ?? "Subtree";
  const showSheet = result !== null || running || error !== null || composing;

  return (
    <div className="ledger-app">
      {/* Running head */}
      <header className="ledger-head">
        <div className="ledger-head-brand">
          <Mark size={16} className="text-ink" />
          <span className="ledger-head-name">AD Query</span>
        </div>
        <div className="ledger-head-conn">
          <span className="mono">{conn?.host}{conn?.port ? ":" + conn.port : ""}</span>
          <span className="ledger-head-sep">·</span>
          <span>{isAD ? "Active Directory" : "LDAP"}</span>
          <span className="ledger-head-sep">·</span>
          <button className="ledger-link" onClick={() => setShow365(true)} title={m365.signedIn ? `Microsoft 365, signed in${m365.account ? " as " + m365.account : ""}` : "Connect Microsoft 365"}>
            {m365.signedIn ? <>365 <span className="mono">{m365.account || "signed in"}</span></> : "Connect 365"}
          </button>
        </div>
        <div className="ledger-head-acts">
          <button className="ledger-link" onClick={toggleTheme}>{theme === "light" ? "Dark" : "Light"}</button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="ledger-link">Tools</button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => offerUpdate(true)}>Check for updates</DropdownMenuItem>
              <DropdownMenuItem onSelect={async () => { try { await ClearCache(); toast.success("Cached data cleared. The next query re-fetches from the directory."); } catch (e: any) { toast.error("Couldn't clear cache", { description: String(e?.message ?? e) }); } }}>Clear cached data</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={disconnect}>Disconnect</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* The sheet */}
      <main className="ledger-sheet">
        <Registers active={register} onChange={openRegister} savedCount={saved.length} isAD={isAD} />

        {register === "stale" ? (
          <Suspense fallback={null}><StaleRegister isAD={isAD} baseDN={req.baseDN} signedIn365={m365.signedIn} onOpen={openQuery} /></Suspense>
        ) : register === "privileged" ? (
          <Suspense fallback={null}><PrivilegedRegister baseDN={req.baseDN} isAD={isAD} /></Suspense>
        ) : register === "licences" ? (
          <Suspense fallback={null}><LicencesRegister isAD={isAD} baseDN={req.baseDN} signedIn365={m365.signedIn} onConnect365={() => setShow365(true)} /></Suspense>
        ) : register === "policies" ? (
          <Suspense fallback={null}><PoliciesRegister isAD={isAD} /></Suspense>
        ) : register === "bulk" ? (
          <Suspense fallback={null}><BulkRegister req={req} signedIn365={m365.signedIn} onPickColumns={() => { setRegister("search"); requestPicker("columns"); }} /></Suspense>
        ) : register === "saved" ? (
          <section className="ledger-open">
            <div className="ledger-eyebrow">Saved queries</div>
            {saved.length === 0 && <p className="ledger-note">Nothing saved yet. Run a query, then choose Save on the meta line under the heading.</p>}
            <div className="ledger-lines">
              {saved.map((s) => (
                <div key={s.id} className="ledger-line is-register">
                  <button className="ledger-line-name" onClick={() => openQuery({ ...s.query, search: s.query.search ?? "" })}>{s.name}</button>
                  <span className="ledger-line-desc">{describeQuery(s.query, locations, isAD)}</span>
                  <button className="ledger-link mono ledger-line-meta" onClick={() => setSaved(deleteSavedQuery(s.id))}>forget</button>
                </div>
              ))}
            </div>
          </section>
        ) : showSheet ? (
          <>
            <QueryHeading req={req} setReq={setReq} isAD={isAD} running={running} onRun={() => runQuery()} locations={locations} schemaAttributes={schema}
              result={result ? { count: result.count, truncated: result.truncated, fetchedAt: cacheAt, fromCache, sortLabel } : null}
              onRescan={() => runQuery(undefined, true)} signedIn365={m365.signedIn} onCheck365={() => setShow365Filter(true)} onExport={() => setShowExport(true)}
              onSaved={() => setSaved(loadSavedQueries())} requestedPicker={picker} />
            {error && <ErrorBanner error={error} className="mx-6 mb-3" />}
            <div className="ledger-body">
              {result && entries.length === 0 && !running ? (
                <div className="ledger-empty">
                  <div className="ledger-empty-title">No matches</div>
                  <p className="ledger-note">Nothing in this location matched. Broaden a condition, switch the match to any, or widen the location.</p>
                </div>
              ) : !result && running ? (
                <div className="ledger-empty"><p className="ledger-note">Searching the directory…</p></div>
              ) : !result ? (
                <div className="ledger-empty"><p className="ledger-note">Set the question above, then press Run or Enter.</p></div>
              ) : (
                <LedgerGrid entries={sorted} loading={running} columns={columns} sort={sort} onSort={toggleSort} selectedDN={selected?.dn ?? null} onSelectRow={selectRow}
                  checked={checked} onToggleCheck={(dn) => setChecked((s) => { const n = new Set(s); n.has(dn) ? n.delete(dn) : n.add(dn); return n; })}
                  onToggleAll={() => setChecked((s) => (s.size === entries.length ? new Set() : new Set(entries.map((e) => e.dn))))}
                  factsColumn={paneMode === "column" ? factsColumn : null} onInspectColumn={inspectColumn} />
              )}
              {result && (
                <SidePane mode={paneMode} onMode={setPaneMode} entries={sorted} columns={columns} factsColumn={factsColumn} onPickColumn={setFactsColumn}
                  onFilterValue={filterValue} onSort={toggleSort} onHide={hideColumn} onCopy={copyText} selected={selected} onClearRow={() => setSelected(null)} isAD={isAD} />
              )}
            </div>
          </>
        ) : (
          <OpeningSheet req={req} setReq={setReq} isAD={isAD} locations={locations} signedIn365={m365.signedIn} onRun={() => runQuery()} onRunQuery={openQuery} onOpenRegister={openRegister}
            onPickType={() => requestPicker("type")} onPickLocation={() => requestPicker("location")} onPickCondition={() => requestPicker("filters")} onPickColumns={() => requestPicker("columns")}
            typeLabel={describeType(req, isAD)} locationLabel={describeLocation(req, locations)} />
        )}
      </main>

      {/* Foot */}
      <footer className="ledger-foot">
        <span className="ledger-foot-dot" aria-hidden />
        <span>Connected</span>
        <span className="mono ledger-foot-dn" title={req.baseDN}>{req.baseDN}</span>
        <span className="ledger-head-sep">·</span>
        <span>{scopeLabel}</span>
        <span className="flex-1" />
        <span className="mono">
          {[result ? `${result.count.toLocaleString()} rows` : "", checked.size > 0 ? `${checked.size} marked` : "", elapsed !== null ? `${elapsed} ms` : "", version ? `v${version}` : ""].filter(Boolean).join(" · ")}
        </span>
      </footer>

      {show365 && <Suspense fallback={null}><M365Dialog onClose={() => setShow365(false)} onChange={refreshM365} /></Suspense>}
      {show365Filter && <License365Dialog count={result?.count ?? 0} busy={busy365} onApply={apply365} onClose={() => setShow365Filter(false)} />}
      {showExport && result && (
        <ExportDialog allEntries={sorted} selectedEntries={sorted.filter((e) => checked.has(e.dn))} columns={columns}
          meta={{ directory: `${conn?.host ?? ""}${req.baseDN ? " · " + req.baseDN : ""}`, scope: scopeLabel, filter: effectiveFilter(req), tool: `AD Query ${version || "dev"}` }}
          onClose={() => setShowExport(false)} />
      )}

      <Toaster position="bottom-right" />
    </div>
  );
}

export default App;
