import type { ldap } from "../../wailsjs/go/models";
import { csvValue, DateFormat } from "./format";

export interface CsvOptions {
  delimiter: string; // "," ";" or "\t"
  includeHeader: boolean;
  includeDN: boolean;
  bom: boolean; // Excel-friendly UTF-8 BOM
  multiValueJoin: string;
  dateFormat: DateFormat;
  evidenceHeader: boolean; // prepend an audit-evidence metadata block
}

export const DEFAULT_CSV_OPTIONS: CsvOptions = {
  delimiter: ",",
  includeHeader: true,
  includeDN: true,
  bom: true,
  multiValueJoin: "; ",
  dateFormat: "iso",
  evidenceHeader: true,
};

// Provenance for the export's evidence header, who/what/when, so a CSV handed
// to Governance is self-describing.
export interface EvidenceMeta {
  generatedAt: string;  // ISO timestamp (caller supplies, keeps buildCsv pure)
  directory?: string;   // server · base DN
  scope?: string;       // e.g. "Subtree"
  filter?: string;      // effective LDAP filter
  tool?: string;        // e.g. "AD Query 0.1.0"
}

function escapeCell(value: string, delimiter: string): string {
  if (value.includes('"') || value.includes(delimiter) || value.includes("\n") || value.includes("\r")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// Build CSV text from the chosen rows and columns, in column order.
export function buildCsv(
  entries: ldap.Entry[],
  columns: string[],
  opts: CsvOptions,
  meta?: EvidenceMeta
): string {
  const cols = opts.includeDN ? ["dn", ...columns] : columns;
  const lines: string[] = [];

  if (opts.evidenceHeader && meta) {
    const d = opts.delimiter;
    const kv = (k: string, v: string) => escapeCell(k, d) + d + escapeCell(v, d);
    lines.push(escapeCell("AD Query export evidence", d));
    lines.push(kv("Generated", meta.generatedAt));
    if (meta.tool) lines.push(kv("Tool", meta.tool));
    if (meta.directory) lines.push(kv("Directory", meta.directory));
    if (meta.scope) lines.push(kv("Scope", meta.scope));
    if (meta.filter) lines.push(kv("Filter", meta.filter));
    lines.push(kv("Rows", String(entries.length)));
    lines.push(kv("Columns", cols.join(", ")));
    lines.push(""); // blank separator before the table
  }

  if (opts.includeHeader) {
    lines.push(cols.map((c) => escapeCell(c, opts.delimiter)).join(opts.delimiter));
  }

  for (const e of entries) {
    const cells = cols.map((c) => {
      const v = c === "dn" ? e.dn : csvValue(c, e.attributes?.[c], opts.multiValueJoin, opts.dateFormat);
      return escapeCell(v, opts.delimiter);
    });
    lines.push(cells.join(opts.delimiter));
  }

  return (opts.bom ? "﻿" : "") + lines.join("\r\n");
}

// Trigger a browser/WebView2 download of the CSV text.
export function downloadCsv(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
