import { describe, it, expect } from "vitest";
import { combineLastSeen, daysSince, isStale } from "./lastseen";

// 133516992000000000 = 2024-02-06T13:20:00Z
const AD_FT = "133516992000000000";
const NOW = new Date("2024-05-10T00:00:00Z"); // ~94 days after the AD time

describe("combineLastSeen", () => {
  it("takes the more recent of AD vs 365", () => {
    const ls = combineLastSeen(AD_FT, "2024-04-01T00:00:00Z");
    expect(ls.source).toBe("365");
    expect(ls.date?.toISOString()).toBe("2024-04-01T00:00:00.000Z");
  });
  it("uses AD when it is newer", () => {
    expect(combineLastSeen(AD_FT, "2023-01-01T00:00:00Z").source).toBe("AD");
  });
  it("handles only one side present", () => {
    expect(combineLastSeen(AD_FT, undefined).source).toBe("AD");
    expect(combineLastSeen("0", "2024-04-01T00:00:00Z").source).toBe("365"); // AD '0' = never
    expect(combineLastSeen(undefined, undefined).source).toBeNull();
  });
});

describe("daysSince / isStale", () => {
  it("counts days and flags stale past the threshold", () => {
    const ls = combineLastSeen(AD_FT, undefined); // 2024-02-06T13:20Z
    expect(daysSince(ls.date, NOW)).toBe(93);
    expect(isStale(ls, 90, NOW)).toBe(true);
    expect(isStale(ls, 120, NOW)).toBe(false);
  });
  it("treats never-seen as stale", () => {
    expect(isStale({ date: null, source: null }, 90, NOW)).toBe(true);
  });
});
