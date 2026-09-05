// The first page: open a directory. The mark and the product name anchor
// the card; below them one line says what to do. On a domain-joined PC the
// joined domain is one sentence and one button. Otherwise a short form:
// two fields, a sign-in switch, and a single button. Help lives in
// placeholders and tooltips, not paragraphs.
import { useEffect, useState } from "react";
import { Mark } from "./Mark";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Connect, StoreSecret, GetSecret, DeleteSecret, DetectDomain } from "../../wailsjs/go/main/App";
import { ldap, sysenv } from "../../wailsjs/go/models";
import { ConnectionProfile, loadProfiles, saveProfile, deleteProfile } from "../lib/profiles";
import { parseServer } from "../lib/server";

interface Props {
  onConnected: (info: ldap.ServerInfo, opts: ldap.ConnectOptions) => void;
}

const AUTH: [string, string][] = [["simple", "Username and password"], ["sspi", "Windows sign-in"]];

export function ConnectionPanel({ onConnected }: Props) {
  const [server, setServer] = useState("");
  const [bindDN, setBindDN] = useState("");
  const [password, setPassword] = useState("");
  const [auth, setAuth] = useState("simple");
  const [acceptSelfSigned, setAcceptSelfSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ConnectionProfile[]>(() => loadProfiles());
  const [remember, setRemember] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [detected, setDetected] = useState<sysenv.Domain | null>(null);
  const [mode, setMode] = useState<"detecting" | "auto" | "manual">("detecting");

  useEffect(() => {
    Promise.resolve()
      .then(() => DetectDomain())
      .then((d) => { setDetected(d); setMode(d.joined ? "auto" : "manual"); })
      .catch(() => setMode("manual"));
  }, []);

  const parsed = parseServer(server);
  const isLdaps = parsed.encryption === "ldaps";

  async function open(opts: ldap.ConnectOptions, after?: () => Promise<void>) {
    setBusy(true); setError(null);
    try {
      const info = await Connect(opts);
      if (after) await after();
      onConnected(info, opts);
    } catch (e: any) { setError(String(e?.message ?? e)); } finally { setBusy(false); }
  }
  function connectAuto() {
    if (!detected) return;
    open(ldap.ConnectOptions.createFrom({ host: detected.server, port: 389, encryption: "none", bindDN: "", password: "", insecureSkipVerify: true, timeoutSeconds: 30, auth: "sspi" }));
  }
  function connectManual() {
    const opts = ldap.ConnectOptions.createFrom({ host: parsed.host, port: parsed.port, encryption: parsed.encryption, bindDN, password, insecureSkipVerify: isLdaps ? acceptSelfSigned : true, timeoutSeconds: 30, auth });
    const name = profileName.trim() || parsed.host;
    open(opts, remember && name ? async () => {
      setProfiles(saveProfile({ name, host: parsed.host, port: parsed.port, encryption: parsed.encryption, bindDN, insecureSkipVerify: acceptSelfSigned }));
      try { if (password) await StoreSecret(name, password); } catch { /* the connection still opened; the password just was not kept */ }
    } : undefined);
  }
  // Dev only: compiled out of production builds, so no test credentials ship.
  function connectDev() {
    setServer("localhost:3389"); setBindDN("cn=admin,dc=adquery,dc=test"); setPassword("AdminPass123!"); setAuth("simple");
    open(ldap.ConnectOptions.createFrom({ host: "localhost", port: 3389, encryption: "none", bindDN: "cn=admin,dc=adquery,dc=test", password: "AdminPass123!", insecureSkipVerify: true, timeoutSeconds: 30, auth: "simple" }));
  }
  async function loadProfile(p: ConnectionProfile) {
    setError(null);
    setServer(p.encryption === "ldaps" ? `ldaps://${p.host}:${p.port}` : `${p.host}:${p.port}`);
    setBindDN(p.bindDN);
    try { setPassword(await GetSecret(p.name)); } catch { setPassword(""); }
  }
  async function removeProfile(name: string) { setProfiles(deleteProfile(name)); try { await DeleteSecret(name); } catch { /* */ } }

  return (
    <div className="ledger-connect">
      <div className="ledger-connect-sheet">
        <h1 className="ledger-title is-large ledger-connect-brand"><Mark size={28} className="text-ink" />AD Query</h1>

        {mode === "detecting" && <p className="ledger-lede">Checking this machine for a domain…</p>}

        {mode === "auto" && detected && (
          <>
            <p className="ledger-lede">This computer is joined to <b className="mono">{detected.domain.toUpperCase()}</b>. Sign in as <span className="mono">{detected.user || "the current user"}</span>, no password needed.</p>
            {error && <ErrorBanner error={error} className="mt-4" />}
            <div className="ledger-connect-acts">
              <button className="ledger-run is-large" onClick={connectAuto} disabled={busy}>{busy ? "Connecting…" : `Connect to ${detected.domain.toUpperCase()}`}</button>
              <button className="ledger-link" onClick={() => { setError(null); setMode("manual"); }}>a different directory</button>
            </div>
          </>
        )}

        {mode === "manual" && (
          <>
            <p className="ledger-lede">
              {detected?.joined
                ? <>Open a directory, or <button className="ledger-link" onClick={() => { setError(null); setMode("auto"); }}>use this computer's domain</button>.</>
                : "Open a directory to begin."}
            </p>

            {profiles.length > 0 && (
              <>
                <div className="ledger-h4">Saved</div>
                <div className="ledger-lines">
                  {profiles.map((p) => (
                    <div key={p.name} className="ledger-line is-register" style={{ gridTemplateColumns: "1fr auto auto" }}>
                      <button className="ledger-line-name" onClick={() => loadProfile(p)} title={`${p.bindDN}@${p.host}:${p.port}`}>{p.name}</button>
                      <span className="mono ledger-line-meta">{p.host}:{p.port}</span>
                      <button className="ledger-link mono ledger-line-meta" onClick={() => removeProfile(p.name)} aria-label={`delete ${p.name}`}>forget</button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="ledger-field">
              <label className="ledger-eyebrow" htmlFor="c-server">Server <span className="ledger-help" title="Your domain controller or directory host. Start with ldaps:// for an encrypted connection.">?</span></label>
              <input id="c-server" className="mono" value={server} onChange={(e) => setServer(e.target.value)} placeholder="dc01.contoso.com" autoFocus
                title="Start with ldaps:// for an encrypted connection" />
            </div>

            <div className="ledger-field">
              <span className="ledger-eyebrow">Sign in with</span>
              <div className="ledger-radio" role="radiogroup">
                {AUTH.map(([v, l]) => (
                  <button key={v} role="radio" aria-checked={auth === v} className={"ledger-tab" + (auth === v ? " is-on" : "")} onClick={() => setAuth(v)}>{l}</button>
                ))}
              </div>
            </div>

            {auth === "simple" && (
              <>
                <div className="ledger-field">
                  <label className="ledger-eyebrow" htmlFor="c-user">Username</label>
                  <input id="c-user" className="mono" value={bindDN} onChange={(e) => setBindDN(e.target.value)} placeholder="you@contoso.com" title="you@contoso.com, CONTOSO\you, or a distinguished name" />
                </div>
                <div className="ledger-field">
                  <label className="ledger-eyebrow" htmlFor="c-pass">Password</label>
                  <input id="c-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={(e) => { if (e.key === "Enter" && server.trim()) connectManual(); }} />
                </div>
              </>
            )}
            {auth === "sspi" && (
              <p className="ledger-note" style={{ marginTop: 12 }}>Signs in as the Windows account you are logged in with. Needs a PC joined to the domain; if the domain controller requires LDAP signing, use an ldaps:// address.</p>
            )}

            <div className="ledger-connect-options">
              {isLdaps && (
                <label className="ledger-inline-check">
                  <input type="checkbox" checked={acceptSelfSigned} onChange={(e) => setAcceptSelfSigned(e.target.checked)} />
                  <span>accept a self-signed certificate</span>
                </label>
              )}
              <label className="ledger-inline-check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>save this connection{remember ? " as" : ""}</span>
              </label>
              {remember && <input className="ledger-inline-input mono" value={profileName} placeholder={parsed.host || "a name"} onChange={(e) => setProfileName(e.target.value)} aria-label="connection name" />}
            </div>

            {error && <ErrorBanner error={error} className="mt-4" />}

            <div className="ledger-connect-acts">
              <button className="ledger-run is-large" onClick={connectManual} disabled={busy || !server.trim()}>{busy ? "Connecting…" : "Open connection"}</button>
            </div>
            {import.meta.env.DEV && (
              <p className="ledger-connect-dev"><button className="ledger-link" onClick={connectDev} disabled={busy}>dev: local test directory</button></p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
