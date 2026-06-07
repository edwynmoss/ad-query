import { useEffect, useRef, useState } from "react";
import { Loader2, Cloud, CheckCircle2, ExternalLink } from "lucide-react";
import { M365SignInInteractive, M365StartSignIn, M365PollSignIn, M365SignedIn, M365SignOut } from "../../wailsjs/go/main/App";
import type { m365 } from "../../wailsjs/go/models";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/error-banner";

interface Props { onClose: () => void; onChange?: (signedIn: boolean) => void; }

const TENANT_KEY = "adquery.m365.tenant";
const CLIENT_KEY = "adquery.m365.client";

export function M365Dialog({ onClose, onChange }: Props) {
  const [tenant, setTenant] = useState(() => localStorage.getItem(TENANT_KEY) ?? "");
  const [client, setClient] = useState(() => localStorage.getItem(CLIENT_KEY) ?? "");
  const [phase, setPhase] = useState<"config" | "browser" | "pending" | "done">("config");
  const [dc, setDc] = useState<m365.DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const poll = useRef<number | null>(null);

  useEffect(() => {
    M365SignedIn().then((s) => { if (s) setPhase("done"); }).catch(() => {});
    return () => { if (poll.current) clearInterval(poll.current); };
  }, []);

  function persist() {
    localStorage.setItem(TENANT_KEY, tenant.trim());
    localStorage.setItem(CLIENT_KEY, client.trim());
  }
  function finish(signedIn: boolean) {
    if (poll.current) { clearInterval(poll.current); poll.current = null; }
    if (signedIn) { setPhase("done"); onChange?.(true); }
  }

  // Primary: seamless browser sign-in (auth-code + PKCE). Opens the default
  // browser — silent if already signed in — and resolves when done.
  async function signIn() {
    setBusy(true); setError(null); persist();
    setPhase("browser");
    try {
      await M365SignInInteractive(tenant.trim(), client.trim());
      finish(true);
    } catch (e: any) {
      setError(String(e?.message ?? e)); setPhase("config");
    } finally { setBusy(false); }
  }

  // Fallback: device code, for headless/locked-down machines where the loopback
  // browser flow can't complete.
  async function signInWithCode() {
    setBusy(true); setError(null); persist();
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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[460px]">
        <DialogHeader>
          <DialogTitle><span className="flex items-center gap-2"><Cloud size={16} className="text-brand" /><span className="display text-[16px] font-semibold">Microsoft 365</span></span></DialogTitle>
        </DialogHeader>

        <div className="py-5 space-y-4">
          {phase === "config" && (
            <>
              <p className="text-[12px] text-ink-2">
                Sign in with your Microsoft account to enrich results with Entra facts (account exists/enabled, licenses, last sign-in). Delegated sign-in <b className="text-ink">as you</b> — no password stored, and nothing to register: it uses Microsoft's standard sign-in app.
              </p>
              <details className="rounded-lg border border-line px-3 py-2">
                <summary className="eyebrow cursor-pointer select-none text-ink-3">Advanced · use your own tenant / app</summary>
                <div className="space-y-3 mt-3">
                  <div><span className="eyebrow block mb-1.5">Tenant ID <span className="text-ink-3">(or "organizations")</span></span><Input className="font-mono h-8" value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="organizations (default)" /></div>
                  <div><span className="eyebrow block mb-1.5">Client (application) ID</span><Input className="font-mono h-8" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Microsoft Graph sign-in app (default)" /></div>
                  <p className="text-[11px] text-ink-3">Only needed if your organization requires its own app registration. See docs/M365.md.</p>
                </div>
              </details>
              <p className="text-[11px] text-ink-3">Opens your browser and signs you in automatically if you already have a Microsoft session. Your admin may need to approve the read-only access once for the tenant.</p>
            </>
          )}

          {phase === "browser" && (
            <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <Loader2 size={14} className="animate-spin" /> Continue sign-in in your browser… it'll return here automatically.
            </div>
          )}

          {phase === "pending" && dc && (
            <div className="space-y-3">
              <p className="text-[12.5px] text-ink-2">Open the sign-in page and enter this code:</p>
              <div className="text-center py-2">
                <div className="display text-[30px] tracking-[0.18em] select-all font-semibold">{dc.user_code}</div>
              </div>
              <Button variant="outline" asChild className="w-full"><a href={dc.verification_uri} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {dc.verification_uri}</a></Button>
              <div className="flex items-center gap-2 text-[12px] text-ink-3"><Loader2 size={13} className="animate-spin" /> Waiting for you to finish signing in…</div>
            </div>
          )}

          {phase === "done" && (
            <div className="flex items-center gap-2 text-[13px] text-success">
              <CheckCircle2 size={16} /> Signed in to Microsoft 365.
            </div>
          )}

          {error && <ErrorBanner error={error} />}
        </div>

        <DialogFooter className="sm:justify-between items-center">
          {phase === "config"
            ? <button className="text-[11px] text-ink-3 hover:text-ink underline-offset-2 hover:underline" onClick={signInWithCode} disabled={busy}>Can't use a browser? Sign in with a code</button>
            : <span />}
          {phase === "done"
            ? <Button variant="outline" onClick={signOut}>Sign out</Button>
            : <Button className="px-5" onClick={signIn} disabled={busy || phase === "browser" || phase === "pending"}>
                {busy || phase === "browser" ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
                {phase === "browser" ? "Waiting…" : phase === "pending" ? "Waiting…" : "Sign in"}
              </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
