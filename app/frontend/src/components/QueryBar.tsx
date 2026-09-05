// The shape of a query and how it compiles to an LDAP filter. The toolbar that
// used to live here has been replaced by QueryHeading (the heading of the
// sheet); this module keeps the types every other component imports.
import { Condition, MatchOp, compileConditions, quickSearchFilter, combineAnd } from "../lib/filterBuilder";

export interface QueryState {
  baseDN: string;
  scope: number;
  filter: string;
  attributes: string[];
  conditions: Condition[];
  matchOp: MatchOp;
  search?: string;   // plain-language quick search across identity fields
}

export function effectiveFilter(req: QueryState): string {
  return combineAnd(combineAnd(req.filter, quickSearchFilter(req.search ?? "")), compileConditions(req.conditions, req.matchOp));
}

// A directory location the user can pick by name (mapped to a base DN behind
// the scenes, nobody should have to type a distinguished name).
export interface DirLocation {
  dn: string;
  label: string;
  depth: number;
}
