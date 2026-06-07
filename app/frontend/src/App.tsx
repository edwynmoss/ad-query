import { useState } from "react";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import { Disconnect, Search, SchemaAttributes } from "../wailsjs/go/main/App";
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
  const [theme, setTheme] = useState<Theme>(getTheme());

  function toggleTheme() { const t = theme === "light" ? "dark" : "light"; applyTheme(t); setTheme(t); }

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

  async function runQuery(override?: QueryState) {
    const q = override ?? req;
    setRunning(true); setError(null); setSelected(null);
    const t0 = performance.now();
    try {
      const res = await Search(ldap.SearchRequest.createFrom({ baseDN: q.baseDN, scope: q.scope, filter: effectiveFilter(q), attributes: q.attributes, pageSize: 1000, sizeLimit: 0 }));
      setResult(res); setElapsed(Math.round(performance.now() - t0));
    } catch (e: any) { setError(String(e?.message ?? e)); setResult(null); setElapsed(null); }
    finally { setRunning(false); }
  }

  // Open a report/query into the grid and run it in one step.
  function openReport(q: QueryState) { setReq(q); runQuery(q); }

  // Identities (UPN/mail) of the current result set, for the per-set 365 tally.
  const resultIdentities = (result?.entries ?? [])
    .map((e) => e.attributes?.userPrincipalName?.[0] || e.attributes?.mail?.[0] || "")
    .filter(Boolean);

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
          <span className="h-5 w-px bg-line" />
          <Button variant="ghost" size="icon" onClick={toggleTheme} title="Toggle theme" aria-label="toggle theme">{theme === "light" ? <Moon size={15} /> : <Sun size={15} />}</Button>
          <Button variant="outline" size="sm" onClick={disconnect}>Disconnect</Button>
        </div>
      </header>

      <div className="flex-1 flex flex-col min-h-0">
        <QueryBar req={req} setReq={setReq} isAD={server.isActiveDirectory} running={running} onRun={() => runQuery()} onOpenReport={openReport} resultIdentities={resultIdentities} schemaAttributes={schema} locations={locations} />

        {error && (
          <div className="mx-4 mt-3 px-3 py-2 text-[12px] rounded-md selectable bg-critical-soft text-critical border border-line">{error}</div>
        )}

        <div className="flex-1 flex min-h-0">
          <ResultsGrid result={result} loading={running} columns={req.attributes} selectedDN={selected?.dn ?? null} onSelectRow={setSelected} />
          <Inspector entry={selected} onClose={() => setSelected(null)} />
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

      <Toaster position="bottom-right" />
    </div>
  );
}

export default App;
