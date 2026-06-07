import { useEffect, useRef, useState } from "react";
import { X, Loader2, Cloud, CheckCircle2, ExternalLink } from "lucide-react";
import { M365StartSignIn, M365PollSignIn, M365SignedIn, M365SignOut } from "../../wailsjs/go/main/App";
import type { m365 } from "../../wailsjs/go/models";

interface Props { onClose: () => void; onChange?: (signedIn: boolean) => void; }

const TENANT_KEY = "adquery.m365.tenant";
const CLIENT_KEY = "adquery.m365.client";

export function M365Dialog({ onClose, onChange }: Props) {
  const [tenant, setTenant] = useState(() => localStorage.getItem(TENANT_KEY) ?? "");
  const [client, setClient] = useState(() => localStorage.getItem(CLIENT_KEY) ?? "");
  const [phase, setPhase] = useState<"config" | "pending" | "done">("config");
  const [dc, setDc] = useState<m365.DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const poll = useRef<number | null>(null);

  useEffect(() => {
    M365SignedIn().then((s) => { if (s) setPhase("done"); }).catch(() => {});
    return () => { if (poll.current) clearInterval(poll.current); };
  }, []);

  function finish(signedIn: boolean) {
    if (poll.current) { clearInterval(poll.current); poll.current = null; }
    if (signedIn) { setPhase("done"); onChange?.(true); }
  }

  async function signIn() {
    setBusy(true); setError(null);
    localStorage.setItem(TENANT_KEY, tenant.trim());
    localStorage.setItem(CLIENT_KEY, client.trim());
    try {
      const code = await M365StartSignIn(tenant.trim(), client.trim());
      setDc(code); setPhase("pending");
      const intervalMs = Math.max(3, code.interval || 5) * 1000;
      poll.current = window.setInterval(async () => {
        try {
          const ok = await M365PollSignIn();
          if (ok) finish(true);
        } catch (e: any) {
          setError(String(e?.message ?? e)); setPhase("config");
          if (poll.current) { clearInterval(poll.current); poll.current = null; }
        }
      }, intervalMs);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setBusy(false); }
  }

  async function signOut() { await M365SignOut(); setPhase("config"); setDc(null); onChange?.(false); }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center" style={{ background: "rgba(0,0,0,0.40)" }} onClick={onClose}>
      <div className="card w-[460px]" style={{ boxShadow: "0 16px 50px rgba(20,18,12,0.28)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid var(--color-line)" }}>
          <div className="flex items-center gap-2"><Cloud size={16} style={{ color: "var(--color-accent)" }} /><span className="display text-[16px]" style={{ fontWeight: 600 }}>Microsoft 365</span></div>
          <button className="btn btn-quiet btn-icon" onClick={onClose}><X size={15} /></button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {phase === "config" && (
            <>
              <p className="text-[12px]" style={{ color: "var(--color-ink-2)" }}>
                Sign in to your tenant to enrich results with Entra facts (account exists/enabled, licenses, last sign-in). Uses delegated sign-in <b style={{ color: "var(--color-ink)" }}>as you</b> — no password stored.
              </p>
              <div><span className="eyebrow block mb-1.5">Tenant ID <span style={{ color: "var(--color-ink-3)" }}>(or "organizations")</span></span><input className="input mono" value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="contoso.onmicrosoft.com or GUID" /></div>
              <div><span className="eyebrow block mb-1.5">Client (application) ID</span><input className="input mono" value={client} onChange={(e) => setClient(e.target.value)} placeholder="public client app registration GUID" /></div>
              <p className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>Needs a one-time Entra app registration (public client, delegated <span className="mono">User.Read.All</span>). See docs/M365.md.</p>
            </>
          )}

          {phase === "pending" && dc && (
            <div className="space-y-3">
              <p className="text-[12.5px]" style={{ color: "var(--color-ink-2)" }}>Open the sign-in page and enter this code:</p>
              <div className="text-center py-2">
                <div className="display text-[30px] tracking-[0.18em] select-all" style={{ fontWeight: 600 }}>{dc.user_code}</div>
              </div>
              <a className="btn w-full" href={dc.verification_uri} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {dc.verification_uri}</a>
              <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--color-ink-3)" }}><Loader2 size={13} className="animate-spin" /> Waiting for you to finish signing in…</div>
            </div>
          )}

          {phase === "done" && (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--color-ok)" }}>
              <CheckCircle2 size={16} /> Signed in to Microsoft 365.
            </div>
          )}

          {error && <div className="text-[12px] px-4 py-2.5 rounded-2xl selectable" style={{ background: "var(--color-danger-weak)", color: "var(--color-danger)" }}>{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5" style={{ borderTop: "1px solid var(--color-line)" }}>
          {phase === "done"
            ? <button className="btn" onClick={signOut}>Sign out</button>
            : <button className="btn btn-primary px-5" onClick={signIn} disabled={busy || phase === "pending" || !client.trim()}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}{phase === "pending" ? "Waiting…" : "Sign in"}
              </button>}
        </div>
      </div>
    </div>
  );
}
