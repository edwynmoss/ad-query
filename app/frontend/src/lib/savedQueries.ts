// Local persistence for named queries. Stored in localStorage (per-app webview
// profile) so queries survive restarts without any backend round-trip.

import type { QueryState } from "../components/QueryBar";

export interface SavedQuery {
  id: string;
  name: string;
  query: QueryState;
}

const KEY = "adquery.savedQueries";

export function loadSavedQueries(): SavedQuery[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(list: SavedQuery[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function saveQuery(name: string, query: QueryState): SavedQuery[] {
  const list = loadSavedQueries();
  const trimmed = name.trim();
  if (!trimmed) return list;
  // Replace an existing query of the same name, else append.
  const existing = list.findIndex((q) => q.name.toLowerCase() === trimmed.toLowerCase());
  const entry: SavedQuery = {
    id: existing >= 0 ? list[existing].id : `q${Date.now()}`,
    name: trimmed,
    query,
  };
  if (existing >= 0) list[existing] = entry;
  else list.push(entry);
  persist(list);
  return list;
}

export function deleteSavedQuery(id: string): SavedQuery[] {
  const list = loadSavedQueries().filter((q) => q.id !== id);
  persist(list);
  return list;
}
