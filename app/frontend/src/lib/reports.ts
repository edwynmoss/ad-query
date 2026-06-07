import type { QueryState } from "../components/QueryBar";
import { OBJECT_TYPES, filterFor } from "./objectTypes";

// A report is a named, repeatable recipe you run with one click to download a
// CSV. Built-ins cover the common asks; your saved queries also appear as
// downloadable reports.
export type ReportKind = "query" | "stale" | "license" | "privileged";

export interface Report {
  id: string;
  name: string;
  description: string;
  kind: ReportKind;
  typeKey?: string;   // object type used to resolve the LDAP filter (built-ins)
  columns?: string[]; // output columns (built-ins)
}

export const BUILTIN_REPORTS: Report[] = [
  {
    id: "users-all", name: "All users", kind: "query", typeKey: "users",
    description: "Every user account with the common attributes.",
    columns: ["displayName", "sAMAccountName", "mail", "department", "title", "userAccountControl"],
  },
  {
    id: "stale", name: "Stale accounts (AD + 365)", kind: "stale", typeKey: "users",
    description: "Users not seen in AD or Microsoft 365 within the stale window. Sign in to 365 to include cloud sign-ins.",
    columns: ["displayName", "sAMAccountName", "userPrincipalName", "userAccountControl", "lastLogonTimestamp"],
  },
  {
    id: "licenses", name: "Licenses & sign-in", kind: "license",
    description: "Microsoft 365 licensed users with last sign-in. Filter by licence; optionally show only dormant seats to reclaim.",
  },
  {
    id: "privileged", name: "Privileged access", kind: "privileged",
    description: "Members of high-privilege groups (Domain Admins, etc.), including nested, with risk flags.",
  },
];

// Resolve a built-in (or saved) report into a concrete query for the connected
// directory (AD vs plain LDAP changes the filter; base DN comes from context).
export function resolveQuery(r: Report, isAD: boolean, baseDN: string): QueryState {
  const t = OBJECT_TYPES.find((x) => x.key === (r.typeKey ?? "users")) ?? OBJECT_TYPES[0];
  return {
    baseDN,
    scope: 2,
    filter: filterFor(t, isAD),
    attributes: r.columns ? [...r.columns] : [...t.defaultAttributes],
    conditions: [],
    matchOp: "and",
  };
}
