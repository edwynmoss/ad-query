// Visual filter model that compiles to a valid RFC 4515 LDAP filter string.
// The compiled output is ANDed onto the object-type base filter at query time.

export type MatchOp = "and" | "or";

export interface Condition {
  id: string;
  attribute: string;
  operator: OperatorKey;
  value: string;
}

export type OperatorKey =
  | "eq"
  | "neq"
  | "present"
  | "notpresent"
  | "contains"
  | "startswith"
  | "endswith"
  | "gte"
  | "lte"
  | "bitand";

export interface OperatorMeta {
  key: OperatorKey;
  label: string;
  needsValue: boolean;
}

export const OPERATORS: OperatorMeta[] = [
  { key: "eq", label: "equals", needsValue: true },
  { key: "neq", label: "not equals", needsValue: true },
  { key: "contains", label: "contains", needsValue: true },
  { key: "startswith", label: "starts with", needsValue: true },
  { key: "endswith", label: "ends with", needsValue: true },
  { key: "present", label: "is present", needsValue: false },
  { key: "notpresent", label: "not present", needsValue: false },
  { key: "gte", label: ">=", needsValue: true },
  { key: "lte", label: "<=", needsValue: true },
  { key: "bitand", label: "bit set (AD)", needsValue: true },
];

// RFC 4515 §3 escaping for filter assertion values.
export function escapeLdapValue(v: string): string {
  let out = "";
  for (const ch of v) {
    switch (ch) {
      case "\\": out += "\\5c"; break;
      case "*": out += "\\2a"; break;
      case "(": out += "\\28"; break;
      case ")": out += "\\29"; break;
      case "\0": out += "\\00"; break;
      default: out += ch;
    }
  }
  return out;
}

function needsValue(op: OperatorKey): boolean {
  return OPERATORS.find((o) => o.key === op)?.needsValue ?? true;
}

// Is a condition complete enough to compile?
export function isConditionValid(c: Condition): boolean {
  if (!c.attribute.trim()) return false;
  if (needsValue(c.operator) && !c.value.trim()) return false;
  return true;
}

export function compileCondition(c: Condition): string {
  const a = c.attribute.trim();
  const v = escapeLdapValue(c.value);
  switch (c.operator) {
    case "eq": return `(${a}=${v})`;
    case "neq": return `(!(${a}=${v}))`;
    case "present": return `(${a}=*)`;
    case "notpresent": return `(!(${a}=*))`;
    case "contains": return `(${a}=*${v}*)`;
    case "startswith": return `(${a}=${v}*)`;
    case "endswith": return `(${a}=*${v})`;
    case "gte": return `(${a}>=${v})`;
    case "lte": return `(${a}<=${v})`;
    case "bitand": return `(${a}:1.2.840.113556.1.4.803:=${v})`;
    default: return "";
  }
}

// Compile a set of conditions into a single filter (or "" when none are valid).
export function compileConditions(conditions: Condition[], match: MatchOp): string {
  const parts = conditions.filter(isConditionValid).map(compileCondition);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `(${match === "and" ? "&" : "|"}${parts.join("")})`;
}

// Combine a base filter (from the object-type preset) with extra conditions.
export function combineAnd(base: string, extra: string): string {
  const b = base.trim();
  const e = extra.trim();
  if (!e) return b;
  if (!b) return e;
  return `(&${b}${e})`;
}

let counter = 0;
export function newCondition(): Condition {
  counter += 1;
  return { id: `c${counter}`, attribute: "", operator: "eq", value: "" };
}
