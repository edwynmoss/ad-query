import { fileTimeToDate } from "./format";

// Combines a "last seen" signal from on-prem AD (lastLogonTimestamp, a Windows
// FILETIME) and Entra/365 (last interactive sign-in, an ISO datetime), taking
// whichever is more recent, and flags accounts not seen anywhere for a while.

export interface LastSeen {
  date: Date | null;
  source: "AD" | "365" | null;
}

export const DEFAULT_STALE_DAYS = 90;

export function combineLastSeen(adFiletime?: string, m365Iso?: string): LastSeen {
  const ad = adFiletime ? fileTimeToDate(adFiletime) : null;
  let m: Date | null = null;
  if (m365Iso) {
    const d = new Date(m365Iso);
    if (!isNaN(d.getTime())) m = d;
  }
  if (ad && m) return ad.getTime() >= m.getTime() ? { date: ad, source: "AD" } : { date: m, source: "365" };
  if (ad) return { date: ad, source: "AD" };
  if (m) return { date: m, source: "365" };
  return { date: null, source: null };
}

export function daysSince(d: Date | null, now: Date = new Date()): number | null {
  if (!d) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

// A Windows FILETIME (string) for "N days ago", used to build an AD-side
// filter like (lastLogonTimestamp<=...) to preview stale accounts server-side.
export function fileTimeDaysAgo(days: number, now: number = Date.now()): string {
  const ms = now - days * 86_400_000;
  const ft = (BigInt(Math.floor(ms)) + 11644473600000n) * 10000n;
  return ft.toString();
}

// Stale = never seen, or last seen longer ago than the threshold.
export function isStale(ls: LastSeen, thresholdDays: number = DEFAULT_STALE_DAYS, now: Date = new Date()): boolean {
  const dd = daysSince(ls.date, now);
  return dd === null || dd > thresholdDays;
}
