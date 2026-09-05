// The first page: open a directory. On a domain-joined PC it offers the
// joined domain as one sentence and one button; otherwise a short form set
// like the rest of the ledger, with saved connections as lines.
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
  const [naming, setNaming] = useState(false);
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

  async function open(opts: ldap.ConnectOptions) {
    setBusy(true); setError(null);
    try { const info = await Connect(opts); onConnected(info, opts); }
    catch (e: any) { setError(String(e?.message ?? e)); } finally { setBusy(false); }
  }
  function connectAuto() {
    if (!detected) return;
    open(ldap.ConnectOptions.createFrom({ host: detected.server, port: 389, encryption: "none", bindDN: "", password: "", insecureSkipVerify: true, timeoutSeconds: 30, auth: "sspi" }));
  }
  function connectManual() {
    open(ldap.ConnectOptions.createFrom({ host: parsed.host, port: parsed.port, encryption: parsed.encryption, bindDN, password, insecureSkipVerify: isLdaps ? acceptSelfSigned : true, timeoutSeconds: 30, auth }));
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
  async function saveCurrentProfile() {
    const name = profileName.trim(); if (!name) { setNaming(false); return; }
    setProfiles(saveProfile({ name, host: parsed.host, port: parsed.port, encryption: parsed.encryption, bindDN, insecureSkipVerify: acceptSelfSigned }));
    try { if (password) await StoreSecret(name, password); } catch (e: any) { setError("Saved the connection, but could not store the password: " + String(e?.message ?? e)); }
    setProfileName(""); setNaming(false);
  }
  async function removeProfile(name: string) { setProfiles(deleteProfile(name)); try { await DeleteSecret(name); } catch { /* */ } }

  return (
    <div className="ledger-connect">
      <div className="ledger-connect-sheet">
        <div className="ledger-head-brand"><Mark size={16} className="text-ink" /><span className="ledger-head-name">AD Query</span></div>
        <h1 className="ledger-title is-large">Open a directory</h1>

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
                ? <>Or <button className="ledger-link" onClick={() => { setError(null); setMode("auto"); }}>use this computer's domain, {detected.domain.toUpperCase()}</button>.</>
                : detected ? "This PC is not joined to a domain. Enter the directory to connect to." : "Could not check this PC for a domain. Enter the directory to connect to."}
            </p>

            {profiles.length > 0 && (
              <>
                <div className="ledger-h4">Saved connections</div>
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
              <label className="ledger-eyebrow" htmlFor="c-server">Server</label>
              <input id="c-server" className="mono" value={server} onChange={(e) => setServer(e.target.value)} placeholder="dc01.contoso.com" autoFocus />
              <p className="ledger-note">Your domain controller or directory host. Start with ldaps:// for an encrypted connection.</p>
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
                  <input id="c-user" className="mono" value={bindDN} onChange={(e) => setBindDN(e.target.value)} placeholder="you@contoso.com" />
                  <p className="ledger-note">As you@contoso.com, CONTOSO\you, or a full distinguished name.</p>
                </div>
                <div className="ledger-field">
                  <label className="ledger-eyebrow" htmlFor="c-pass">Password</label>
                  <input id="c-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={(e) => { if (e.key === "Enter" && server.trim()) connectManual(); }} />
                </div>
              </>
            )}
            {auth === "sspi" && (
              <p className="ledger-note" style={{ marginTop: 14 }}>Signs in as the Windows account you are logged in with. Needs a PC joined to the domain. If the domain controller requires LDAP signing, use an ldaps:// address.</p>
            )}

            {isLdaps && (
              <label className="ledger-inline-check" style={{ marginTop: 14, display: "inline-flex" }}>
                <input type="checkbox" checked={acceptSelfSigned} onChange={(e) => setAcceptSelfSigned(e.target.checked)} />
                <span>accept a self-signed certificate</span>
              </label>
            )}

            {error && <ErrorBanner error={error} className="mt-4" />}

            <div className="ledger-connect-acts">
              <button className="ledger-run is-large" onClick={connectManual} disabled={busy || !server.trim()}>{busy ? "Connecting…" : "Open connection"}</button>
              {naming
                ? <input autoFocus className="ledger-inline-input mono" value={profileName} placeholder="name this connection" onChange={(e) => setProfileName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveCurrentProfile(); if (e.key === "Escape") setNaming(false); }} onBlur={saveCurrentProfile} />
                : <button className="ledger-link" onClick={() => setNaming(true)} disabled={!server.trim()}>save this connection</button>}
              {import.meta.env.DEV && <button className="ledger-link" onClick={connectDev} disabled={busy}>dev: local test directory</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
