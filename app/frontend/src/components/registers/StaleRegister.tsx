// Stale accounts: users not seen in AD (and, when signed in, Microsoft 365)
// for a number of days. Preview opens the AD-side candidates in the Search
// ledger; Download folds in cloud sign-ins and exports the combined set.
import { useState } from "react";
import { Search, M365Check } from "../../../wailsjs/go/main/App";
import { ldap, m365 } from "../../../wailsjs/go/models";
import type { QueryState } from "../QueryBar";
import { OBJECT_TYPES, filterFor } from "../../lib/objectTypes";
import { combineAnd } from "../../lib/filterBuilder";
import { combineLastSeen, daysSince, isStale, fileTimeDaysAgo } from "../../lib/lastseen";
import { csvValue, decodeUAC } from "../../lib/format";
import { rowsToCsv } from "../../lib/bulk";
import { downloadCsv } from "../../lib/csv";
import { ErrorBanner } from "@/components/ui/error-banner";
import { toast } from "sonner";
import { RegisterFrame, InlineNumber, InlineCheck } from "./RegisterFrame";

interface Props {
  isAD: boolean;
  baseDN: string;
  signedIn365: boolean;
  onOpen: (q: QueryState) => void;
}

const first = (e: ldap.Entry, a: string) => e.attributes?.[a]?.[0] ?? "";
const COLUMNS = ["displayName", "sAMAccountName", "userPrincipalName", "userAccountControl", "lastLogonTimestamp"];

export function StaleRegister({ isAD, baseDN, signedIn365, onOpen }: Props) {
  const [days, setDays] = useState(90);
  const [enabledOnly, setEnabledOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ rows: number; at: number } | null>(null);

  function query(): QueryState {
    const t = OBJECT_TYPES.find((x) => x.key === "users") ?? OBJECT_TYPES[0];
    const ft = fileTimeDaysAgo(days);
    let filter = combineAnd(filterFor(t, isAD), `(|(!(lastLogonTimestamp=*))(lastLogonTimestamp<=${ft}))`);
    if (enabledOnly && isAD) filter = combineAnd(filter, "(!(userAccountControl:1.2.840.113556.1.4.803:=2))");
    return { baseDN, scope: 2, filter, attributes: [...COLUMNS], conditions: [], matchOp: "and", search: "" };
  }

  async function download() {
    setBusy(true); setError(null);
    try {
      const q = query();
      const res = await Search(ldap.SearchRequest.createFrom({ baseDN: q.baseDN, scope: q.scope, filter: q.filter, attributes: [...COLUMNS, "mail"], pageSize: 1000, sizeLimit: 0 }));
      const entries = res.entries ?? [];
      const byId = new Map<string, m365.User>();
      if (signedIn365) {
        const ids = Array.from(new Set(entries.map((e) => first(e, "userPrincipalName") || first(e, "mail")).filter(Boolean)));
        if (ids.length) for (const u of await M365Check(ids, false)) byId.set((u.identity || "").toLowerCase(), u);
      }
      const staleCol = `Stale (>${days}d)`;
      const cols = ["displayName", "sAMAccountName", "userPrincipalName", "Account", "AD last logon", "365 last sign-in", "Last seen", "Days idle", staleCol];
      const rows: Record<string, string>[] = [];
      for (const e of entries) {
        const adFt = first(e, "lastLogonTimestamp");
        const upn = first(e, "userPrincipalName") || first(e, "mail");
        const cloud = upn ? byId.get(upn.toLowerCase()) : undefined;
        const ls = combineLastSeen(adFt, cloud?.lastSignIn);
        if (!isStale(ls, days)) continue;
        rows.push({
          displayName: first(e, "displayName"), sAMAccountName: first(e, "sAMAccountName"), userPrincipalName: upn,
          Account: decodeUAC(first(e, "userAccountControl")).includes("Disabled") ? "Disabled" : "Enabled",
          "AD last logon": csvValue("lastLogonTimestamp", [adFt]),
          "365 last sign-in": signedIn365 ? (cloud?.lastSignIn ?? "") : "(not signed in)",
          "Last seen": ls.date ? ls.date.toISOString() : "Never",
          "Days idle": daysSince(ls.date)?.toString() ?? "",
          [staleCol]: "Yes",
        });
      }
      setLast({ rows: rows.length, at: Date.now() });
      if (rows.length === 0) { toast.info(`No accounts stale beyond ${days} days${signedIn365 ? "" : " in AD. Sign in to 365 to fold in cloud sign-ins."}`); return; }
      downloadCsv(`adquery-stale-${days}d-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(cols, rows));
      toast.success(`Stale report: ${rows.length.toLocaleString()} ${rows.length === 1 ? "account" : "accounts"} exported`);
    } catch (e: any) { setError(String(e?.message ?? e)); } finally { setBusy(false); }
  }

  if (!isAD) {
    return (
      <RegisterFrame title="Stale accounts" lede="Users not seen for a number of days, judged from the last logon Active Directory records.">
        <div className="ledger-prose">
          <p><b>This register needs Active Directory.</b></p>
          <p>Staleness is read from lastLogonTimestamp, which only Active Directory keeps. This directory reports as plain LDAP and does not record when an account last signed in, so there is nothing to judge here.</p>
          <p className="ledger-note">If your directory stores a last-login attribute of its own, add a condition on it in Search instead.</p>
        </div>
      </RegisterFrame>
    );
  }

  return (
    <RegisterFrame
      title="Stale accounts"
      lede={<>Users not seen in the last <InlineNumber value={days} onChange={setDays} /> days{isAD ? <>, <InlineCheck checked={enabledOnly} onChange={setEnabledOnly}>enabled accounts only</InlineCheck></> : null}.</>}
      meta={<>
        <button className="ledger-link" onClick={() => onOpen(query())}>Preview in the ledger</button>
        <button className="ledger-link" onClick={download} disabled={busy}>{busy ? "Preparing…" : "Download CSV"}</button>
        {last && <span className="is-dim">{last.rows.toLocaleString()} stale at {new Date(last.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
      </>}
    >
      <div className="ledger-prose">
        <p><b>Preview</b> opens the AD-side candidates in the Search ledger, where every column and fact is available.</p>
        <p><b>Download</b> checks each candidate against Microsoft 365 as well{signedIn365 ? ", so a recent cloud sign-in clears an account that looks stale in AD" : ". You are not signed in to 365, so the download is AD only; connect 365 from the running head to include cloud sign-ins"}. The file lists AD last logon, 365 last sign-in, the later of the two, and days idle.</p>
        <p className="ledger-note">Stale means no logon recorded on any domain controller (lastLogonTimestamp) within the window. The replicated value lags by up to two weeks, so a threshold under 14 days is not meaningful.</p>
        {error && <ErrorBanner error={error} />}
      </div>
    </RegisterFrame>
  );
}
