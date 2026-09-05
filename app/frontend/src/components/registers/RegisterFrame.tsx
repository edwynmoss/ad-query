// The frame every register shares: a heading set like the Search heading
// (eyebrow, title, a line of prose that holds the controls, a meta line) and
// a body below the rule. Registers are pages of the same ledger, so nothing
// here looks like a dialog.
import type { ReactNode } from "react";

interface Props {
  title: string;
  eyebrow?: string;
  back?: { label: string; onClick: () => void };
  lede?: ReactNode;
  controls?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}

export function RegisterFrame({ title, eyebrow, back, lede, controls, meta, children }: Props) {
  return (
    <>
      <div className="ledger-qhead">
        <div className="ledger-eyebrow">{back ? <><button className="ledger-eyebrow-link" onClick={back.onClick}>{back.label}</button><span className="ledger-eyebrow-sep">›</span></> : null}{eyebrow ?? "Register"}</div>
        <h2 className="ledger-title">{title}</h2>
        {lede && <p className="ledger-lede">{lede}</p>}
        {controls && <div className="ledger-controls">{controls}</div>}
        {meta && <div className="ledger-meta">{meta}</div>}
      </div>
      <div className="ledger-body">
        <div className="ledger-register-body">{children}</div>
      </div>
    </>
  );
}

/** A number typed inline in a sentence ("idle more than [90] days"). */
export function InlineNumber({ value, onChange, disabled, min = 1 }: { value: number; onChange: (n: number) => void; disabled?: boolean; min?: number }) {
  return (
    <input type="number" min={min} className="ledger-inline-num mono" value={value} disabled={disabled}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))} aria-label="number" />
  );
}

/** A yes/no typed inline in a sentence. */
export function InlineCheck({ checked, onChange, disabled, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <label className={"ledger-inline-check" + (disabled ? " is-disabled" : "")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
