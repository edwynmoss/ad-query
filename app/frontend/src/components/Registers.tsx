// The thumb tabs along the sheet's top edge. One register is open at a time;
// Saved sits on the right because it is a list of things you made, not a
// report the app made.
export type RegisterKey = "search" | "stale" | "privileged" | "licences" | "all-users" | "bulk" | "saved";

export const REGISTERS: Array<{ key: RegisterKey; label: string; needs365?: boolean }> = [
  { key: "search", label: "Search" },
  { key: "stale", label: "Stale accounts" },
  { key: "privileged", label: "Privileged access" },
  { key: "licences", label: "Licences", needs365: true },
  { key: "all-users", label: "All users" },
  { key: "bulk", label: "Bulk lookup" },
];

interface Props {
  active: RegisterKey;
  onChange: (key: RegisterKey) => void;
  savedCount: number;
}

export function Registers({ active, onChange, savedCount }: Props) {
  return (
    <div className="ledger-tabs" role="tablist" aria-label="Registers">
      {REGISTERS.map((r) => (
        <button key={r.key} role="tab" aria-selected={active === r.key} className={"ledger-tab" + (active === r.key ? " is-on" : "")} onClick={() => onChange(r.key)}>
          {r.label}
        </button>
      ))}
      <span className="flex-1" />
      <button role="tab" aria-selected={active === "saved"} className={"ledger-tab" + (active === "saved" ? " is-on" : "")} onClick={() => onChange("saved")}>
        Saved{savedCount > 0 ? <span className="ledger-tab-count">{savedCount}</span> : null}
      </button>
    </div>
  );
}
