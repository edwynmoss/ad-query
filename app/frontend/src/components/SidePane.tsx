// The right-hand pane of the sheet: facts about a column, or one row in full.
// A two-word switch at the top decides which; the pane is empty until there
// is a result.
import type { ldap } from "../../wailsjs/go/models";
import { ColumnFacts } from "./ColumnFacts";
import { InspectorBody } from "./Inspector";

export type PaneMode = "column" | "row";

interface Props {
  mode: PaneMode;
  onMode: (m: PaneMode) => void;
  entries: ldap.Entry[];
  columns: string[];
  factsColumn: string | null;
  onPickColumn: (col: string) => void;
  onFilterValue: (column: string, value: string, exclude: boolean) => void;
  onSort: (column: string) => void;
  onHide: (column: string) => void;
  onCopy: (text: string) => void;
  selected: ldap.Entry | null;
  onClearRow: () => void;
  isAD: boolean;
}

export function SidePane({ mode, onMode, entries, columns, factsColumn, onPickColumn, onFilterValue, onSort, onHide, onCopy, selected, onClearRow, isAD }: Props) {
  const col = factsColumn && columns.includes(factsColumn) ? factsColumn : columns[0] ?? null;
  return (
    <aside className="ledger-pane" aria-label="Details">
      <div className="ledger-pane-switch" role="tablist">
        <button role="tab" aria-selected={mode === "column"} className={"ledger-tab" + (mode === "column" ? " is-on" : "")} onClick={() => onMode("column")}>Column</button>
        <button role="tab" aria-selected={mode === "row"} className={"ledger-tab" + (mode === "row" ? " is-on" : "")} onClick={() => onMode("row")}>
          Row{selected ? <span className="ledger-tab-count">1</span> : null}
        </button>
      </div>
      <div className="ledger-pane-body">
        {mode === "column" && (col
          ? <ColumnFacts key={col} column={col} columns={columns} entries={entries} onPickColumn={onPickColumn} onFilterValue={onFilterValue} onSort={onSort} onHide={onHide} onCopy={onCopy} />
          : <p className="ledger-note p-4">Pick some columns to see facts about them.</p>)}
        {mode === "row" && (selected
          ? <InspectorBody key={selected.dn} entry={selected} isAD={isAD} onClose={onClearRow} />
          : <p className="ledger-note p-4">Click a line in the ledger to read the whole record here. Use the arrow keys to move between lines.</p>)}
      </div>
    </aside>
  );
}
