import { useEffect, useState } from "react";
import { Loader2, X, ArrowRight, ArrowLeft, ShieldCheck } from "lucide-react";
import { Connect, StoreSecret, GetSecret, DeleteSecret, DetectDomain } from "../../wailsjs/go/main/App";
import { ldap, sysenv } from "../../wailsjs/go/models";
import { ConnectionProfile, loadProfiles, saveProfile, deleteProfile } from "../lib/profiles";
import { parseServer } from "../lib/server";

interface Props {
  onConnected: (info: ldap.ServerInfo, opts: ldap.ConnectOptions) => void;
}

const AUTH: [string, string][] = [["simple", "Password"], ["sspi", "Windows SSO"], ["kerberos", "Kerberos"]];

function Label({ children }: { children: React.ReactNode }) {
  return <span className="eyebrow block mb-1.5">{children}</span>;
}

export function ConnectionPanel({ onConnected }: Props) {
  const [server, setServer] = useState("localhost:3389");
  const [bindDN, setBindDN] = useState("cn=admin,dc=adquery,dc=test");
  const [password, setPassword] = useState("AdminPass123!");
  const [auth, setAuth] = useState("simple");
  const [realm, setRealm] = useState("");
  const [kdc, setKdc] = useState("");
  const [spn, setSpn] = useState("");
  const [acceptSelfSigned, setAcceptSelfSigned] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ConnectionProfile[]>(() => loadProfiles());
  const [naming, setNaming] = useState(false);
  const [profileName, setProfileName] = useState("");

  const [detected, setDetected] = useState<sysenv.Domain | null>(null);
  const [mode, setMode] = useState<"detecting" | "auto" | "manual">("detecting");

  useEffect(() => {
    // Promise.resolve(...) so a synchronous throw (e.g. bindings not yet ready)
    // becomes a rejection rather than hanging on "detecting".
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
    open(ldap.ConnectOptions.createFrom({
      host: detected.server, port: 389, encryption: "none",
      bindDN: "", password: "", insecureSkipVerify: true, timeoutSeconds: 30, auth: "sspi",
    }));
  }

  function connectManual() {
    open(ldap.ConnectOptions.createFrom({
      host: parsed.host, port: parsed.port, encryption: parsed.encryption,
      bindDN, password, insecureSkipVerify: isLdaps ? acceptSelfSigned : true,
      timeoutSeconds: 30, auth, realm, kdc, servicePrincipal: spn,
    }));
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
    try { if (password) await StoreSecret(name, password); } catch (e: any) { setError("Saved profile, but could not store password: " + String(e?.message ?? e)); }
    setProfileName(""); setNaming(false);
  }
  async function removeProfile(name: string) { setProfiles(deleteProfile(name)); try { await DeleteSecret(name); } catch { /* */ } }

  return (
    <div className="h-full grid place-items-center px-6" style={{ background: "var(--color-paper)" }}>
      <div className="card w-[460px]" style={{ boxShadow: "0 12px 48px rgba(20,18,12,0.12)" }}>
        <div className="px-7 pt-7 pb-5" style={{ borderBottom: "1px solid var(--color-line)" }}>
          <div className="eyebrow" style={{ color: "var(--color-accent)" }}>Directory Ledger</div>
          <h1 className="display text-[27px] leading-none mt-2" style={{ fontWeight: 600 }}>AD Query</h1>
          <p className="text-[12.5px] mt-2.5" style={{ color: "var(--color-ink-2)" }}>Open a connection to interrogate a directory.</p>
        </div>

        {mode === "detecting" && (
          <div className="px-7 py-10 flex items-center gap-2.5 text-[12.5px]" style={{ color: "var(--color-ink-2)" }}>
            <Loader2 size={15} className="animate-spin" /> Checking this machine for a domain…
          </div>
        )}

        {/* Zero-config: connect to the joined domain as the current user (SSO). */}
        {mode === "auto" && detected && (
          <div className="px-7 py-6 space-y-5">
            <div className="rounded-2xl p-4" style={{ border: "1px solid var(--color-line)", background: "var(--color-sunken)" }}>
              <div className="flex items-center gap-2 eyebrow" style={{ color: "var(--color-accent)" }}><ShieldCheck size={13} /> This computer's domain</div>
              <div className="display text-[19px] mt-1.5" style={{ fontWeight: 600 }}>{detected.domain.toUpperCase()}</div>
              <div className="text-[12.5px] mt-1" style={{ color: "var(--color-ink-2)" }}>
                Sign in as <span className="mono" style={{ color: "var(--color-ink)" }}>{detected.user || "the current user"}</span> — no password.
              </div>
            </div>
            <button className="btn btn-primary w-full" onClick={connectAuto} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}{busy ? "Connecting…" : `Connect to ${detected.domain.toUpperCase()}`}
            </button>
            {error && <div className="text-[12px] px-4 py-2.5 rounded-2xl selectable" style={{ background: "var(--color-danger-weak)", color: "var(--color-danger)" }}>{error}</div>}
            <button className="flex items-center gap-1 text-[12px] mx-auto btn-quiet h-7 px-3 rounded-full" onClick={() => { setError(null); setMode("manual"); }} style={{ color: "var(--color-ink-2)" }}>
              Connect to a different directory <ArrowRight size={12} />
            </button>
          </div>
        )}

        {mode === "manual" && (
          <>
            <div className="px-7 py-6 space-y-5">
              {detected?.joined && (
                <button className="flex items-center gap-1 text-[12px] btn-quiet h-7 px-3 rounded-full" onClick={() => { setError(null); setMode("auto"); }} style={{ color: "var(--color-accent)" }}>
                  <ArrowLeft size={12} /> Use this computer's domain ({detected.domain.toUpperCase()})
                </button>
              )}

              <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
                <span className="eyebrow">Saved</span>
                {profiles.map((p) => (
                  <span key={p.name} className="token cursor-pointer" onClick={() => loadProfile(p)} title={`${p.bindDN}@${p.host}:${p.port}`}>
                    {p.name}<button className="opacity-50 hover:opacity-100" onClick={(e) => { e.stopPropagation(); removeProfile(p.name); }} aria-label={`delete ${p.name}`}><X size={11} /></button>
                  </span>
                ))}
                {profiles.length === 0 && !naming && <span style={{ color: "var(--color-ink-3)" }}>none</span>}
                {naming
                  ? <input autoFocus className="input mono h-7 w-32" value={profileName} placeholder="name…" onChange={(e) => setProfileName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveCurrentProfile(); if (e.key === "Escape") setNaming(false); }} onBlur={saveCurrentProfile} />
                  : <button className="btn btn-quiet h-7 px-3" onClick={() => setNaming(true)}>Save current</button>}
              </div>

              <div>
                <Label>Server</Label>
                <input className="input mono" value={server} onChange={(e) => setServer(e.target.value)} placeholder="dc01.contoso.com" />
                <p className="text-[11px] mt-1.5" style={{ color: "var(--color-ink-3)" }}>Plain LDAP unless the port is 636 or you prefix <span className="mono">ldaps://</span>.</p>
              </div>

              <div><Label>Authentication</Label><div className="seg w-full">{AUTH.map(([v, l]) => <button key={v} className="flex-1" data-active={auth === v} onClick={() => setAuth(v)}>{l}</button>)}</div></div>

              {auth === "simple" && (<>
                <div><Label>Bind DN / UPN</Label><input className="input mono" value={bindDN} onChange={(e) => setBindDN(e.target.value)} placeholder="user@contoso.com — blank for anonymous" /></div>
                <div><Label>Password</Label><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
              </>)}
              {auth === "sspi" && (
                <p className="text-[12px] leading-relaxed px-4 py-3 rounded-2xl" style={{ background: "var(--color-sunken)", color: "var(--color-ink-2)" }}>
                  Authenticates as the current Windows user — no password. Set the <b style={{ color: "var(--color-ink)" }}>Server</b> to the DC's FQDN.
                </p>
              )}
              {auth === "kerberos" && (<>
                <div className="grid grid-cols-2 gap-3"><div><Label>Username</Label><input className="input mono" value={bindDN} onChange={(e) => setBindDN(e.target.value)} placeholder="administrator" /></div><div><Label>Realm</Label><input className="input mono" value={realm} onChange={(e) => setRealm(e.target.value)} placeholder="CONTOSO.COM" /></div></div>
                <div><Label>Password</Label><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-3"><div><Label>KDC</Label><input className="input mono" value={kdc} onChange={(e) => setKdc(e.target.value)} placeholder="dc01.contoso.com:88" /></div><div><Label>Service principal</Label><input className="input mono" value={spn} onChange={(e) => setSpn(e.target.value)} placeholder="ldap/dc01.contoso.com" /></div></div>
              </>)}

              {isLdaps && (
                <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: "var(--color-ink-2)" }}>
                  <input type="checkbox" checked={acceptSelfSigned} onChange={(e) => setAcceptSelfSigned(e.target.checked)} /> Accept self-signed certificate
                </label>
              )}

              {error && <div className="text-[12px] px-4 py-2.5 rounded-2xl selectable" style={{ background: "var(--color-danger-weak)", color: "var(--color-danger)" }}>{error}</div>}
            </div>

            <div className="px-7 py-5 flex justify-end" style={{ borderTop: "1px solid var(--color-line)" }}>
              <button className="btn btn-primary px-7" onClick={connectManual} disabled={busy || !parsed.host}>
                {busy && <Loader2 size={14} className="animate-spin" />}{busy ? "Connecting…" : "Open connection"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
