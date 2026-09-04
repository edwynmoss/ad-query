import { useEffect, useState } from "react";
import { Loader2, X, ArrowRight, ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Connect, StoreSecret, GetSecret, DeleteSecret, DetectDomain } from "../../wailsjs/go/main/App";
import { ldap, sysenv } from "../../wailsjs/go/models";
import { ConnectionProfile, loadProfiles, saveProfile, deleteProfile } from "../lib/profiles";
import { parseServer } from "../lib/server";

interface Props {
  onConnected: (info: ldap.ServerInfo, opts: ldap.ConnectOptions) => void;
}

const AUTH: [string, string][] = [["simple", "Username & password"], ["sspi", "Windows sign-in"]];

function Label({ children }: { children: React.ReactNode }) {
  return <span className="eyebrow block mb-1.5">{children}</span>;
}

export function ConnectionPanel({ onConnected }: Props) {
  const [server, setServer] = useState("");
  const [bindDN, setBindDN] = useState("");
  const [password, setPassword] = useState("");
  const [auth, setAuth] = useState("simple");
  // Secure by default: verify the server certificate. The user can opt into
  // accepting a self-signed cert per-connection (shown only for LDAPS).
  const [acceptSelfSigned, setAcceptSelfSigned] = useState(false);
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
      timeoutSeconds: 30, auth,
    }));
  }

  // Dev-only: one-click connect to the local test directory. Compiled out of
  // production builds (import.meta.env.DEV is false), so no test creds ship.
  function connectDev() {
    setServer("localhost:3389"); setBindDN("cn=admin,dc=adquery,dc=test"); setPassword("AdminPass123!"); setAuth("simple");
    open(ldap.ConnectOptions.createFrom({
      host: "localhost", port: 3389, encryption: "none",
      bindDN: "cn=admin,dc=adquery,dc=test", password: "AdminPass123!",
      insecureSkipVerify: true, timeoutSeconds: 30, auth: "simple",
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
    <div className="h-full grid place-items-center px-6 bg-page">
      <div className="w-[460px] rounded-xl border border-border bg-card shadow-xl">
        <div className="px-7 pt-7 pb-5 border-b border-line">
          <div className="eyebrow text-brand">Directory Ledger</div>
          <h1 className="display text-[27px] leading-none mt-2 font-semibold">AD Query</h1>
          <p className="text-[12.5px] mt-2.5 text-ink-2">Connect to your directory to search users, groups, and more.</p>
        </div>

        {mode === "detecting" && (
          <div className="px-7 py-10 flex items-center gap-2.5 text-[12.5px] text-ink-2">
            <Loader2 size={15} className="animate-spin" /> Checking this machine for a domain…
          </div>
        )}

        {/* Zero-config: connect to the joined domain as the current user (SSO). */}
        {mode === "auto" && detected && (
          <div className="px-7 py-6 space-y-5">
            <div className="rounded-2xl p-4 border border-line bg-sunken">
              <div className="flex items-center gap-2 eyebrow text-brand"><ShieldCheck size={13} /> This computer's domain</div>
              <div className="display text-[19px] mt-1.5 font-semibold">{detected.domain.toUpperCase()}</div>
              <div className="text-[12.5px] mt-1 text-ink-2">
                Sign in as <span className="mono text-ink">{detected.user || "the current user"}</span>, no password needed.
              </div>
            </div>
            <Button className="w-full" onClick={connectAuto} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}{busy ? "Connecting…" : `Connect to ${detected.domain.toUpperCase()}`}
            </Button>
            {error && <ErrorBanner error={error} />}
            <Button variant="ghost" size="sm" className="mx-auto flex" onClick={() => { setError(null); setMode("manual"); }}>
              Connect to a different directory <ArrowRight size={12} />
            </Button>
          </div>
        )}

        {mode === "manual" && (
          <>
            <div className="px-7 py-6 space-y-5">
              {import.meta.env.DEV && (
                <Button variant="ghost" size="sm" onClick={connectDev} disabled={busy}
                  className="border border-dashed border-brand text-brand">
                  <ShieldCheck size={12} /> Dev: connect to local test directory
                </Button>
              )}
              {detected?.joined ? (
                <Button variant="ghost" size="sm" className="text-brand" onClick={() => { setError(null); setMode("auto"); }}>
                  <ArrowLeft size={12} /> Use this computer's domain ({detected.domain.toUpperCase()})
                </Button>
              ) : (
                <p className="text-[12px] text-ink-2">{detected ? "This PC isn't joined to a domain." : "Couldn't check this PC for a domain."} Enter the directory you want to connect to.</p>
              )}

              <div className="flex items-center gap-2 flex-wrap text-[12px]">
                <span className="eyebrow">Saved</span>
                {profiles.map((p) => (
                  <span key={p.name} className="inline-flex items-center gap-1 h-[26px] pl-2.5 pr-1.5 rounded-md border border-border bg-card text-[11.5px] font-mono cursor-pointer hover:bg-muted" onClick={() => loadProfile(p)} title={`${p.bindDN}@${p.host}:${p.port}`}>
                    {p.name}<button className="opacity-50 hover:opacity-100" onClick={(e) => { e.stopPropagation(); removeProfile(p.name); }} aria-label={`delete ${p.name}`}><X size={11} /></button>
                  </span>
                ))}
                {profiles.length === 0 && !naming && <span className="text-ink-3">none</span>}
                {naming
                  ? <Input autoFocus className="font-mono h-8 w-32 min-w-0" value={profileName} placeholder="name…" onChange={(e) => setProfileName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveCurrentProfile(); if (e.key === "Escape") setNaming(false); }} onBlur={saveCurrentProfile} />
                  : <Button variant="ghost" size="sm" onClick={() => setNaming(true)}>Save current</Button>}
              </div>

              <div>
                <Label>Server address</Label>
                <Input className="font-mono h-8" value={server} onChange={(e) => setServer(e.target.value)} placeholder="dc01.contoso.com" />
                <p className="text-[11px] mt-1.5 text-ink-3">Your domain controller or directory host. Add <span className="mono">ldaps://</span> for a secure connection.</p>
              </div>

              <div>
                <Label>Sign in with</Label>
                <ToggleGroup type="single" size="sm" variant="outline" value={auth} onValueChange={(v) => v && setAuth(v)} className="w-full">
                  {AUTH.map(([v, l]) => <ToggleGroupItem key={v} value={v} className="flex-1">{l}</ToggleGroupItem>)}
                </ToggleGroup>
              </div>

              {auth === "simple" && (<>
                <div>
                  <Label>Username</Label>
                  <Input className="font-mono h-8" value={bindDN} onChange={(e) => setBindDN(e.target.value)} placeholder="you@contoso.com" />
                  <p className="text-[11px] mt-1.5 text-ink-3">Sign-in name as <span className="mono">you@contoso.com</span>, <span className="mono">CONTOSO\you</span>, or a full DN.</p>
                </div>
                <div><Label>Password</Label><Input className="h-8" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></div>
              </>)}
              {auth === "sspi" && (
                <p className="text-[12px] leading-relaxed px-4 py-3 rounded-lg bg-sunken text-ink-2">
                  Signs in as you, the Windows account you're logged in with. No username or password needed.
                </p>
              )}

              {isLdaps && (
                <label className="flex items-center gap-2 text-[12px] cursor-pointer text-ink-2">
                  <Checkbox checked={acceptSelfSigned} onCheckedChange={(v) => setAcceptSelfSigned(!!v)} /> Accept self-signed certificate
                </label>
              )}

              {error && <ErrorBanner error={error} />}
            </div>

            <div className="px-7 py-5 flex justify-end border-t border-line">
              <Button className="px-7" onClick={connectManual} disabled={busy || !server.trim()}>
                {busy && <Loader2 size={14} className="animate-spin" />}{busy ? "Connecting…" : "Open connection"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
