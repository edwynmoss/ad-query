// Display-side formatting for AD values. The canonical, unit-tested decoders
// live in the Go `adtypes` package and back CSV export; these mirror the common
// cases so the grid is readable without a round-trip.

const FILETIME_ATTRS = new Set([
  "lastlogon",
  "lastlogontimestamp",
  "pwdlastset",
  "accountexpires",
  "badpasswordtime",
  "lockouttime",
]);

const FILETIME_EPOCH_OFFSET = 116444736000000000n; // 100ns ticks 1601->1970
const FILETIME_NEVER = 9223372036854775807n;

export function fileTimeToDate(raw: string): Date | null {
  let ft: bigint;
  try {
    ft = BigInt(raw);
  } catch {
    return null;
  }
  if (ft <= 0n || ft === FILETIME_NEVER) return null;
  const unixMs = Number((ft - FILETIME_EPOCH_OFFSET) / 10000n);
  const d = new Date(unixMs);
  return isNaN(d.getTime()) ? null : d;
}

const UAC_FLAGS: [number, string][] = [
  [0x0002, "Disabled"],
  [0x0010, "Locked out"],
  [0x0020, "Password not required"],
  [0x10000, "Password never expires"],
  [0x800000, "Password expired"],
  [0x80000, "Trusted for delegation"],
];

export function decodeUAC(raw: string): string[] {
  const v = parseInt(raw, 10);
  if (isNaN(v)) return [];
  return UAC_FLAGS.filter(([bit]) => (v & bit) !== 0).map(([, name]) => name);
}

export function isFileTimeAttr(attr: string): boolean {
  return FILETIME_ATTRS.has(attr.toLowerCase());
}

// Render an attribute's value(s) for the grid: applies FILETIME / UAC decoding
// where the attribute name calls for it; otherwise joins multi-values.
export function formatValue(attr: string, values: string[] | undefined, joiner = "; "): string {
  if (!values || values.length === 0) return "";
  const a = attr.toLowerCase();
  if (isFileTimeAttr(a)) {
    const d = fileTimeToDate(values[0]);
    return d ? d.toLocaleString() : "Never";
  }
  if (a === "useraccountcontrol") {
    const flags = decodeUAC(values[0]);
    return flags.length ? `${values[0]} (${flags.join(", ")})` : values[0];
  }
  return values.join(joiner);
}

export type DateFormat = "iso" | "local" | "raw";

// Plain value for CSV. FILETIME attributes are rendered per dateFormat:
//   iso   -> ISO-8601 UTC (default, Excel/sort friendly)
//   local -> local locale string
//   raw   -> the raw FILETIME integer as returned by LDAP
export function csvValue(
  attr: string,
  values: string[] | undefined,
  joiner = "; ",
  dateFormat: DateFormat = "iso"
): string {
  if (!values || values.length === 0) return "";
  const a = attr.toLowerCase();
  if (isFileTimeAttr(a) && dateFormat !== "raw") {
    const d = fileTimeToDate(values[0]);
    if (!d) return "";
    return dateFormat === "local" ? d.toLocaleString() : d.toISOString();
  }
  return values.join(joiner);
}
