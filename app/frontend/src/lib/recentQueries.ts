// The last few queries that were run, newest first, so the opening sheet can
// offer them back. Stored per machine in localStorage; a query is identified
// by its effective shape, so re-running the same thing moves it to the top.
import type { QueryState } from "../components/QueryBar";

export interface RecentQuery {
  query: QueryState;
  rows: number;
  at: number; // unix ms
}

const KEY = "adquery.recentQueries.v1";
const MAX = 8;

function signature(q: QueryState): string {
  return JSON.stringify([q.baseDN, q.scope, q.filter, q.search ?? "", q.conditions, q.matchOp, q.attributes]);
}

export function loadRecentQueries(): RecentQuery[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentQuery[]) : [];
    return Array.isArray(list) ? list.filter((r) => r && r.query && typeof r.at === "number") : [];
  } catch {
    return [];
  }
}

export function rememberQuery(query: QueryState, rows: number): RecentQuery[] {
  const sig = signature(query);
  const next: RecentQuery[] = [{ query, rows, at: Date.now() }, ...loadRecentQueries().filter((r) => signature(r.query) !== sig)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: recents are a convenience */
  }
  return next;
}

export function forgetRecentQuery(at: number): RecentQuery[] {
  const next = loadRecentQueries().filter((r) => r.at !== at);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/** "today 08:41", "yesterday", "Mon", "3 Jun" */
export function whenLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  const yesterday = new Date(now - 86_400_000).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `today ${time}`;
  if (yesterday) return "yesterday";
  if (now - at < 6 * 86_400_000) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}
