// Plain-language descriptions of a query, so the heading of the sheet reads
// as a sentence ("Users in Sales, People where department is Sales") and a
// recent query can be recognised at a glance.
import type { QueryState, DirLocation } from "../components/QueryBar";
import { OBJECT_TYPES, filterFor } from "./objectTypes";
import { OPERATORS, isConditionValid, type Condition } from "./filterBuilder";
import { labelFor } from "./attrLabels";

const OP_WORDS: Record<string, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  startswith: "starts with",
  endswith: "ends with",
  present: "is set",
  notpresent: "is empty",
  gte: "is at least",
  lte: "is at most",
  bitand: "has flag",
};

/** "department is Sales", "manager is empty" */
export function describeCondition(c: Condition): string {
  const field = labelFor(c.attribute).replace(/^\w/, (m) => m.toLowerCase());
  const word = OP_WORDS[c.operator] ?? OPERATORS.find((o) => o.key === c.operator)?.label ?? c.operator;
  const needsValue = OPERATORS.find((o) => o.key === c.operator)?.needsValue ?? true;
  return needsValue ? `${field} ${word} ${c.value}` : `${field} ${word}`;
}

/** "Users", "Groups", or "Objects" for a raw filter with no preset. */
export function describeType(q: QueryState, isAD: boolean): string {
  const t = OBJECT_TYPES.find((t) => filterFor(t, isAD) === q.filter);
  if (t) return t.key === "any" ? "Everything" : t.label;
  return q.filter && q.filter !== "(objectClass=*)" ? "Objects matching a raw filter" : "Everything";
}

/** "Sales, People" for OU=Sales,OU=People,DC=..., "entire directory" at the root. */
export function describeLocation(q: QueryState, locations: DirLocation[]): string {
  const known = locations.find((l) => l.dn === q.baseDN);
  if (known) return known.depth === 0 ? "entire directory" : known.label;
  if (!q.baseDN) return "entire directory";
  const parts = q.baseDN.split(",").filter((p) => /^ou=/i.test(p.trim())).map((p) => p.trim().replace(/^ou=/i, ""));
  return parts.length ? parts.join(", ") : "entire directory";
}

/** One line: "Users in Sales, People where department is Sales and title contains manager" */
export function describeQuery(q: QueryState, locations: DirLocation[], isAD: boolean): string {
  const where = q.conditions.filter(isConditionValid).map(describeCondition);
  const joiner = q.matchOp === "or" ? " or " : " and ";
  const parts = [`${describeType(q, isAD)} in ${describeLocation(q, locations)}`];
  if (q.search?.trim()) parts.push(`matching “${q.search.trim()}”`);
  if (where.length) parts.push(`where ${where.join(joiner)}`);
  return parts.join(" ");
}
