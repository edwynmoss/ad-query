// Light/dark theme, persisted. Light is the default (corporate norm).
export type Theme = "light" | "dark";

const KEY = "adquery.theme";

export function getTheme(): Theme {
  return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
}

export function applyTheme(t: Theme): void {
  document.documentElement.classList.toggle("dark", t === "dark");
  localStorage.setItem(KEY, t);
}

export function initTheme(): void {
  applyTheme(getTheme());
}
