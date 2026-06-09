import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Sun, Moon, Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBanner } from "@/components/ui/error-banner";
import { toast } from "sonner";
import { Disconnect, Search, SearchCached, SchemaAttributes, M365SignedIn, M365Account, M365Check } from "../wailsjs/go/main/App";
import { License365Dialog } from "./components/License365Dialog";

const M365Dialog = lazy(() => import("./components/M365Dialog").then((m) => ({ default: m.M365Dialog })));

const LIC_COL = "Microsoft 365 licenses";
const SIGNIN_COL = "365 last sign-in";
import { ldap } from "../wailsjs/go/models";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { QueryBar, QueryState, effectiveFilter, DirLocation } from "./components/QueryBar";
import { ResultsGrid } from "./components/ResultsGrid";
import { Inspector } from "./components/Inspector";
import { getTheme, applyTheme, Theme } from "./lib/theme";

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
  const [cacheAt, setCacheAt] = useState<number | null>(null); // unix s of the data's fetch
  const [fromCache, setFromCache] = useState(false);
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [show365, setShow365] = useState(false);
  const [m365, setM365] = useState<{ signedIn: boolean; account: string }>({ signedIn: false, account: "" });
  const [show365Filter, setShow365Filter] = useState(false);
  const [busy365, setBusy365] = useState(false);
  const [extra365Cols, setExtra365Cols] = useState<string[]>([]);

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

  // Discover OUs so the user can pick a location by name instead of typing a DN.
  async function loadLocations(root: string) {
    const base: DirLocation[] = [{ dn: root, label: "Entire directory", depth: 0 }];
    if (!root) { setLocations(base); return; }
    try {
      const res = await Search(ldap.SearchRequest.createFrom({
        baseDN: root, scope: 2, filter: "(objectClass=organizationalUnit)",
        attributes: ["ou", "name"], pageSize: 1000, sizeLimit: 0,
      }));
      const rootDepth = root.split(",").length;
      const ous: DirLocation[] = (res.entries ?? []).map((e) => ({
        dn: e.dn,
        label: e.attributes?.ou?.[0] ?? e.attributes?.name?.[0] ?? e.dn.split(",")[0].replace(/^[^=]+=/, ""),
        depth: Math.max(1, e.dn.split(",").length - rootDepth),
        sortKey: e.dn.split(",").reverse().join(",").toLowerCase(),
      } as DirLocation & { sortKey: string }));
      ous.sort((a: any, b: any) => (a.sortKey < b.sortKey ? -1 : 1));
      setLocations([...base, ...ous]);
    } catch {
      setLocations(base);
    }
  }

  async function disconnect() {
    await Disconnect();
    setServer(null); setConn(null); setResult(null); setSelected(null); setSchema([]); setLocations([]); setElapsed(null);
  }

  // Enrich the current results with Microsoft 365: keep only users holding the
  // selected licence(s) (empty = any licence) and add licence + sign-in columns.
  async function apply365(skus: string[]) {
    if (!result) return;
    setBusy365(true);
    try {
      const entries = result.entries ?? [];
      const ids = Array.from(new Set(entries.map((e) => e.attributes?.userPrincipalName?.[0] || e.attributes?.mail?.[0] || "").filter(Boolean)));
      const users = ids.length ? await M365Check(ids) : [];
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
      toast.success(`365 check — ${kept.length} of ${entries.length} hold the selected licence`);
    } catch (e: any) {
      toast.error("365 check failed", { description: String(e?.message ?? e) });
    } finally { setBusy365(false); setShow365Filter(false); }
  }

  // refresh=true forces a live re-fetch (Rescan); otherwise a cached result for
  // this exact query is served instantly when one exists.
  async function runQuery(override?: QueryState, refresh = false) {
    const q = override ?? req;
    setRunning(true); setError(null); setSelected(null); setExtra365Cols([]);
    const t0 = performance.now();
    try {
      const cs = await SearchCached(ldap.SearchRequest.createFrom({ baseDN: q.baseDN, scope: q.scope, filter: effectiveFilter(q), attributes: q.attributes, pageSize: 1000, sizeLimit: 0 }), refresh);
      setResult(cs.result ?? null); setCacheAt(cs.fetchedAt); setFromCache(cs.fromCache); setElapsed(Math.round(performance.now() - t0));
    } catch (e: any) { setError(String(e?.message ?? e)); setResult(null); setElapsed(null); setCacheAt(null); setFromCache(false); }
    finally { setRunning(false); }
  }

  // Open a report/query into the grid and run it in one step.
  function openReport(q: QueryState) { setReq(q); runQuery(q); }

  // Identities (UPN/mail) of the current result set, for the per-set 365 tally.
  const resultIdentities = useMemo(
    () => (result?.entries ?? [])
      .map((e) => e.attributes?.userPrincipalName?.[0] || e.attributes?.mail?.[0] || "")
      .filter(Boolean),
    [result],
  );

  if (!server) return <ConnectionPanel onConnected={onConnected} />;

  const scopeLabel = ["Base", "One level", "Subtree"][req.scope] ?? "Subtree";

  return (
    <div className="h-full flex flex-col">
      {/* Masthead */}
      <header className="flex items-center justify-between pl-4 pr-3 h-12 shrink-0 bg-surface border-b border-line">
        <div className="flex items-baseline gap-3">
          <span className="display text-[17px] font-semibold">AD&nbsp;Query</span>
          <span className="eyebrow text-brand">Directory Ledger</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-[12px] text-ink-2">
            <span className="mono">{conn?.host}:{conn?.port}</span>
            <Badge variant="secondary">{server.isActiveDirectory ? "Active Directory" : "LDAP"}</Badge>
          </span>

          {/* Microsoft 365 connection state — persistent, click to manage. */}
          <button
            onClick={() => setShow365(true)}
            title={m365.signedIn ? `Microsoft 365 — signed in${m365.account ? " as " + m365.account : ""}` : "Connect Microsoft 365"}
            className={"flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] transition-colors " +
              (m365.signedIn ? "bg-success-soft text-success hover:brightness-95" : "text-ink-3 hover:bg-sunken hover:text-ink")}
          >
            <Cloud size={13} />
            {m365.signedIn
              ? <span className="max-w-[180px] truncate">365 · {m365.account || "signed in"}</span>
              : <span>Connect 365</span>}
          </button>

          <span className="h-5 w-px bg-line" />
          <Button variant="ghost" size="icon" onClick={toggleTheme} title="Toggle theme" aria-label="toggle theme">{theme === "light" ? <Moon size={15} /> : <Sun size={15} />}</Button>
          <Button variant="outline" size="sm" onClick={disconnect}>Disconnect</Button>
        </div>
      </header>

      <div className="flex-1 flex flex-col min-h-0">
        <QueryBar req={req} setReq={setReq} isAD={server.isActiveDirectory} running={running} onRun={() => runQuery()} onOpenReport={openReport} resultIdentities={resultIdentities} schemaAttributes={schema} locations={locations} />

        {error && <ErrorBanner error={error} className="mx-4 mt-3" />}

        <div className="flex-1 flex min-h-0">
          <ResultsGrid result={result} loading={running} columns={[...req.attributes, ...extra365Cols]} selectedDN={selected?.dn ?? null} onSelectRow={setSelected} signedIn365={m365.signedIn} onCheck365={() => setShow365Filter(true)}
            fetchedAt={cacheAt} fromCache={fromCache} onRescan={() => runQuery(undefined, true)}
            exportMeta={{ directory: `${conn?.host ?? ""}${req.baseDN ? " · " + req.baseDN : ""}`, scope: scopeLabel, filter: effectiveFilter(req), tool: "AD Query 0.1.0" }} />
          <Inspector entry={selected} isAD={server.isActiveDirectory} onClose={() => setSelected(null)} />
        </div>
      </div>

      {/* Document footer */}
      <footer className="flex items-center justify-between px-4 h-7 shrink-0 text-[11px] bg-surface border-t border-line text-ink-3">
        <div className="flex items-center gap-2.5">
          <span className="eyebrow text-success">● Connected</span>
          <span className="mono">{req.baseDN}</span>
          <span>· {scopeLabel}</span>
        </div>
        <div className="flex items-center gap-3 mono">
          {result && <span>{result.count.toLocaleString()} records</span>}
          {elapsed !== null && <span>{elapsed} ms</span>}
        </div>
      </footer>

      {show365 && (
        <Suspense fallback={null}>
          <M365Dialog onClose={() => setShow365(false)} onChange={refreshM365} />
        </Suspense>
      )}

      {show365Filter && (
        <License365Dialog count={result?.count ?? 0} busy={busy365} onApply={apply365} onClose={() => setShow365Filter(false)} />
      )}

      <Toaster position="bottom-right" />
    </div>
  );
}

export default App;
