// The sheet before anything has been asked: the search rule with focus, the
// last few queries as ledger lines, and the registers with when they last ran.
import { useEffect, useRef } from "react";
import type { QueryState, DirLocation } from "./QueryBar";
import { describeQuery } from "../lib/describe";
import { loadRecentQueries, whenLabel } from "../lib/recentQueries";
import { REGISTERS, type RegisterKey } from "./Registers";

interface Props {
  req: QueryState;
  setReq: (q: QueryState) => void;
  isAD: boolean;
  locations: DirLocation[];
  signedIn365: boolean;
  onRun: () => void;
  onRunQuery: (q: QueryState) => void;
  onOpenRegister: (key: RegisterKey) => void;
  onPickType: () => void;
  onPickLocation: () => void;
  onPickCondition: () => void;
  onPickColumns: () => void;
  typeLabel: string;
  locationLabel: string;
}

const REGISTER_BLURBS: Record<RegisterKey, string> = {
  search: "",
  stale: "Not seen in AD or Microsoft 365 for 90 days. Accurate last logon across every domain controller.",
  privileged: "Domain Admins and the other high-privilege groups, nested, with risk flags.",
  licences: "Microsoft 365 seats held by accounts dormant in AD and in the cloud.",
  "all-users": "Every user account with the common attributes.",
  bulk: "Drop a CSV or Excel list of names or emails; get every row matched to the directory.",
  saved: "",
};

export function OpeningSheet({ req, setReq, isAD, locations, signedIn365, onRun, onRunQuery, onOpenRegister, onPickType, onPickLocation, onPickCondition, onPickColumns, typeLabel, locationLabel }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const recent = loadRecentQueries();
  useEffect(() => { input.current?.focus(); }, []);

  return (
    <div className="ledger-open">
      <div className="ledger-eyebrow">
        <button className="ledger-eyebrow-link" onClick={onPickType}>{typeLabel}</button>
        <span className="ledger-eyebrow-sep">·</span>
        <button className="ledger-eyebrow-link" onClick={onPickLocation}>{locationLabel}</button>
      </div>
      <div className="ledger-rule-field is-large">
        <input
          ref={input}
          value={req.search ?? ""}
          onChange={(e) => setReq({ ...req, search: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") onRun(); }}
          placeholder="Who are you looking for?"
          aria-label="Search the directory"
        />
        <span className="ledger-rule-hint mono">Enter to run · empty for everyone</span>
      </div>
      <p className="ledger-hint">
        Name, email or username. Or narrow first: <button className="ledger-link" onClick={onPickType}>type</button>, <button className="ledger-link" onClick={onPickLocation}>location</button>, <button className="ledger-link" onClick={onPickCondition}>condition</button>, <button className="ledger-link" onClick={onPickColumns}>columns</button>.
      </p>

      {recent.length > 0 && (
        <>
          <h4 className="ledger-h4">Recent</h4>
          <div className="ledger-lines">
            {recent.map((r) => (
              <button key={r.at} className="ledger-line" onClick={() => onRunQuery(r.query)} title="Run again">
                <span className="ledger-line-text">{describeQuery(r.query, locations, isAD)}</span>
                <span className="mono ledger-line-meta">{r.rows.toLocaleString()} rows</span>
                <span className="mono ledger-line-meta">{whenLabel(r.at)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <h4 className="ledger-h4">Registers</h4>
      <div className="ledger-lines">
        {REGISTERS.filter((r) => r.key !== "search").map((r) => (
          <button key={r.key} className="ledger-line is-register" onClick={() => onOpenRegister(r.key)}>
            <span className="ledger-line-name">{r.label}</span>
            <span className="ledger-line-desc">{REGISTER_BLURBS[r.key]}</span>
            <span className="mono ledger-line-meta">{r.needs365 && !signedIn365 ? "needs 365" : ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
