import * as XLSX from "xlsx";
import { escapeLdapValue, combineAnd } from "./filterBuilder";

// ---- Parsing ---------------------------------------------------------------

export interface Sheet {
  headers: string[];
  rows: Record<string, string>[];
}

// Reads the first worksheet of a CSV or XLSX file into headers + row objects.
export async function parseSpreadsheet(file: File): Promise<Sheet> {
  return parseBuffer(await file.arrayBuffer());
}

// Buffer-level core (also the unit-test entry point).
export function parseBuffer(buf: ArrayBuffer | Uint8Array): Sheet {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { headers: [], rows: [] };
  const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, defval: "" });
  const headers = (aoa[0] ?? []).map((h) => String(h).trim()).filter((h) => h !== "");
  const rows = aoa.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = r[i] != null ? String(r[i]).trim() : ""; });
    return o;
  }).filter((o) => Object.values(o).some((v) => v !== ""));
  return { headers, rows };
}

// ---- Key-column / match-attribute detection --------------------------------

export const MATCH_ATTRS = ["sAMAccountName", "userPrincipalName", "mail"] as const;
export type MatchAttr = (typeof MATCH_ATTRS)[number];

const HEADER_HINTS: { attr: MatchAttr; re: RegExp }[] = [
  { attr: "userPrincipalName", re: /^(upn|userprincipalname|user[\s_-]?principal[\s_-]?name)$/i },
  { attr: "mail", re: /^(e-?mail|mail|email[\s_-]?address|smtp)$/i },
  { attr: "sAMAccountName", re: /^(sam([\s_-]?account)?[\s_-]?name|username|user[\s_-]?id|logon|login|account|netid)$/i },
];

// Guess which column holds the identity and which AD attribute to match it on.
export function detectKey(sheet: Sheet): { column: string; matchAttr: MatchAttr } {
  const { headers, rows } = sheet;
  if (headers.length === 0) return { column: "", matchAttr: "sAMAccountName" };

  // 1) Header-name match wins.
  for (const h of headers) {
    for (const hint of HEADER_HINTS) {
      if (hint.re.test(h.replace(/\s+/g, ""))) return { column: h, matchAttr: hint.attr };
    }
  }
  // 2) Otherwise pick the column whose values look most identity-like, and infer
  //    the attribute from whether the values are UPN/email-shaped (contain "@").
  const sample = rows.slice(0, 30);
  let best = headers[0];
  let bestScore = -1;
  for (const h of headers) {
    const vals = sample.map((r) => r[h]).filter(Boolean);
    if (vals.length === 0) continue;
    const atRate = vals.filter((v) => v.includes("@")).length / vals.length;
    const idRate = vals.filter((v) => /^[\w.@-]{2,64}$/.test(v)).length / vals.length;
    const score = idRate + atRate * 0.5;
    if (score > bestScore) { bestScore = score; best = h; }
  }
  const bestVals = sample.map((r) => r[best]).filter(Boolean);
  const mostlyAt = bestVals.length > 0 && bestVals.filter((v) => v.includes("@")).length / bestVals.length > 0.5;
  return { column: best, matchAttr: mostlyAt ? "userPrincipalName" : "sAMAccountName" };
}

// ---- Lookup filters --------------------------------------------------------

// OR-filter for a chunk of values, ANDed with the object-type base filter so we
// only match the intended class. Returns "" if there are no values.
export function chunkFilter(baseFilter: string, attr: string, values: string[]): string {
  const clean = values.filter((v) => v.trim() !== "");
  if (clean.length === 0) return "";
  const or = `(|${clean.map((v) => `(${attr}=${escapeLdapValue(v)})`).join("")})`;
  return combineAnd(baseFilter, or);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---- CSV output ------------------------------------------------------------

function esc(v: string, delim = ","): string {
  return /["\n\r]|,|;|\t/.test(v) && (v.includes(delim) || /["\n\r]/.test(v)) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// Serialize a generic table (array of row objects) to CSV in the given column order.
export function rowsToCsv(columns: string[], rows: Record<string, string>[], bom = true): string {
  const lines = [columns.map((c) => esc(c)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c] ?? "")).join(","));
  return (bom ? "﻿" : "") + lines.join("\r\n");
}
