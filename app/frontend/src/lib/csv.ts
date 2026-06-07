import type { ldap } from "../../wailsjs/go/models";
import { csvValue, DateFormat } from "./format";

export interface CsvOptions {
  delimiter: string; // "," ";" or "\t"
  includeHeader: boolean;
  includeDN: boolean;
  bom: boolean; // Excel-friendly UTF-8 BOM
  multiValueJoin: string;
  dateFormat: DateFormat;
}

export const DEFAULT_CSV_OPTIONS: CsvOptions = {
  delimiter: ",",
  includeHeader: true,
  includeDN: true,
  bom: true,
  multiValueJoin: "; ",
  dateFormat: "iso",
};

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
  opts: CsvOptions
): string {
  const cols = opts.includeDN ? ["dn", ...columns] : columns;
  const lines: string[] = [];

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
