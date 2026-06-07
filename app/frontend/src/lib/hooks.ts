import { useEffect, useState } from "react";

// Debounce a rapidly-changing value (e.g. a search box) to avoid recomputing
// large suggestion/filter lists on every keystroke.
export function useDebouncedValue<T>(value: T, delayMs = 120): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
