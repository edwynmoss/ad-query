import { useEffect, useState } from "react";
import { X, Loader2, Download, Cloud } from "lucide-react";
import { M365SignedIn, M365LicenseReport, M365Check } from "../../wailsjs/go/main/App";
import type { m365 } from "../../wailsjs/go/models";
import { rowsToCsv } from "../lib/bulk";
import { downloadCsv } from "../lib/csv";

interface Props {
  setIdentities?: string[];
  onClose: () => void;
}

type Mode = "tenant" | "set";

export function LicenseReportDialog({ setIdentities = [], onClose }: Props) {
  const [mode, setMode] = useState<Mode>("tenant");
  const [phase, setPhase] = useState<"loading" | "needsSignin" | "ready" | "error">("loading");
  const [skus, setSkus] = useState<m365.LicenseSku[]>([]);
  const [setRows, setSetRows] = useState<{ label: string; count: number }[]>([]);
  const [setMeta, setSetMeta] = useState({ checked: 0, licensed: 0 });
  const [error, setError] = useState("");
  const hasSet = setIdentities.length > 0;

  useEffect(() => {
    (async () => {
      try {
        if (!(await M365SignedIn())) { setPhase("needsSignin"); return; }
        setPhase("loading");
        if (mode === "tenant") {
          const list = await M365LicenseReport();
          setSkus([...list].sort((a, b) => b.assigned - a.assigned));
        } else {
          const users = await M365Check(setIdentities);
          const counts = new Map<string, number>();
          let licensed = 0;
          for (const u of users) {
            if (u.exists && u.licenses && u.licenses.length) {
              licensed++;
              for (const l of u.licenses) counts.set(l, (counts.get(l) ?? 0) + 1);
            }
          }
          setSetRows([...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count));
          setSetMeta({ checked: users.length, licensed });
        }
        setPhase("ready");
      } catch (e: any) { setError(String(e?.message ?? e)); setPhase("error"); }
    })();
  }, [mode]);

  const totals = skus.reduce((t, s) => ({ p: t.p + s.purchased, a: t.a + s.assigned, f: t.f + s.available }), { p: 0, a: 0, f: 0 });

  function exportCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    if (mode === "tenant") {
      const rows = skus.map((s) => ({ Product: s.product, SKU: s.skuPartNumber, Purchased: String(s.purchased), Assigned: String(s.assigned), Available: String(s.available) }));
      downloadCsv(`adquery-licenses-tenant-${stamp}.csv`, rowsToCsv(["Product", "SKU", "Purchased", "Assigned", "Available"], rows));
    } else {
      const rows = setRows.map((r) => ({ License: r.label, Users: String(r.count) }));
      downloadCsv(`adquery-licenses-set-${stamp}.csv`, rowsToCsv(["License", "Users"], rows));
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center" style={{ background: "rgba(0,0,0,0.40)" }} onClick={onClose}>
      <div className="card w-[560px] max-h-[86vh] flex flex-col" style={{ boxShadow: "0 16px 50px rgba(20,18,12,0.28)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid var(--color-line)" }}>
          <div className="flex items-center gap-2"><Cloud size={16} style={{ color: "var(--color-accent)" }} /><span className="display text-[16px]" style={{ fontWeight: 600 }}>License report</span></div>
          <button className="btn btn-quiet btn-icon" onClick={onClose}><X size={15} /></button>
        </div>

        <div className="px-5 pt-3.5">
          <div className="seg w-full">
            <button className="flex-1" data-active={mode === "tenant"} onClick={() => setMode("tenant")}>Tenant totals</button>
            <button className="flex-1" data-active={mode === "set"} disabled={!hasSet} onClick={() => setMode("set")}>Current results ({setIdentities.length})</button>
          </div>
        </div>

        <div className="overflow-auto px-5 py-4 min-h-[140px]">
          {phase === "loading" && <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--color-ink-2)" }}><Loader2 size={14} className="animate-spin" /> Reading…</div>}
          {phase === "needsSignin" && <div className="text-[12.5px]" style={{ color: "var(--color-ink-2)" }}>Sign in to Microsoft 365 first (the ☁ button), then reopen this report.</div>}
          {phase === "error" && <div className="text-[12px] px-4 py-2.5 rounded-2xl selectable" style={{ background: "var(--color-danger-weak)", color: "var(--color-danger)" }}>{error}</div>}

          {phase === "ready" && mode === "tenant" && (
            <table className="w-full text-[12.5px]" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead><tr style={{ borderBottom: "1px solid var(--color-line-strong)" }}>
                <th className="text-left eyebrow py-1.5">Product</th><th className="text-right eyebrow py-1.5">Purchased</th><th className="text-right eyebrow py-1.5">Assigned</th><th className="text-right eyebrow py-1.5">Free</th>
              </tr></thead>
              <tbody>
                {skus.map((s) => (
                  <tr key={s.skuPartNumber} style={{ borderBottom: "1px solid var(--color-line)" }}>
                    <td className="py-1.5">{s.product}<span className="ml-1.5 text-[10.5px]" style={{ color: "var(--color-ink-3)", fontFamily: "var(--font-mono)" }}>{s.skuPartNumber}</span></td>
                    <td className="text-right" style={{ fontFamily: "var(--font-mono)" }}>{s.purchased}</td>
                    <td className="text-right" style={{ fontFamily: "var(--font-mono)" }}>{s.assigned}</td>
                    <td className="text-right" style={{ fontFamily: "var(--font-mono)", color: s.available < 0 ? "var(--color-danger)" : s.available === 0 ? "var(--color-warn)" : "var(--color-ok)" }}>{s.available}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--color-line-strong)" }}>
                  <td className="py-1.5 font-semibold">Total</td>
                  <td className="text-right font-semibold" style={{ fontFamily: "var(--font-mono)" }}>{totals.p}</td>
                  <td className="text-right font-semibold" style={{ fontFamily: "var(--font-mono)" }}>{totals.a}</td>
                  <td className="text-right font-semibold" style={{ fontFamily: "var(--font-mono)" }}>{totals.f}</td>
                </tr>
              </tbody>
            </table>
          )}

          {phase === "ready" && mode === "set" && (
            <>
              <p className="text-[12px] mb-2" style={{ color: "var(--color-ink-3)" }}>{setMeta.licensed} of {setMeta.checked} users licensed.</p>
              <table className="w-full text-[12.5px]" style={{ fontVariantNumeric: "tabular-nums" }}>
                <thead><tr style={{ borderBottom: "1px solid var(--color-line-strong)" }}><th className="text-left eyebrow py-1.5">License</th><th className="text-right eyebrow py-1.5">Users</th></tr></thead>
                <tbody>
                  {setRows.map((r) => (
                    <tr key={r.label} style={{ borderBottom: "1px solid var(--color-line)" }}>
                      <td className="py-1.5">{r.label}</td>
                      <td className="text-right" style={{ fontFamily: "var(--font-mono)" }}>{r.count}</td>
                    </tr>
                  ))}
                  {setRows.length === 0 && <tr><td colSpan={2} className="py-3 text-center" style={{ color: "var(--color-ink-3)" }}>No licenses across this set.</td></tr>}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5" style={{ borderTop: "1px solid var(--color-line)" }}>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary px-5" onClick={exportCsv} disabled={phase !== "ready"}><Download size={14} /> Export CSV</button>
        </div>
      </div>
    </div>
  );
}
