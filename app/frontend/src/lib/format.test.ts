import { describe, it, expect } from "vitest";
import { fileTimeToDate, decodeUAC, formatValue, csvValue } from "./format";

describe("fileTimeToDate", () => {
  it("converts a real FILETIME to the correct UTC instant", () => {
    // 133516992000000000 = 2024-02-06T13:20:00Z
    expect(fileTimeToDate("133516992000000000")?.toISOString()).toBe("2024-02-06T13:20:00.000Z");
  });
  it("treats 0 and the max sentinel as 'never' (null)", () => {
    expect(fileTimeToDate("0")).toBeNull();
    expect(fileTimeToDate("9223372036854775807")).toBeNull();
  });
  it("returns null for non-numeric input", () => {
    expect(fileTimeToDate("nope")).toBeNull();
  });
});

describe("decodeUAC", () => {
  it("decodes common flags", () => {
    expect(decodeUAC("514")).toContain("Disabled");          // 512|2
    expect(decodeUAC("66048")).toContain("Password never expires"); // 512|0x10000
    expect(decodeUAC("512")).toEqual([]);                    // plain normal account
  });
});

describe("formatValue", () => {
  it("decodes FILETIME attributes to a date string", () => {
    expect(formatValue("lastLogonTimestamp", ["133516992000000000"])).toContain("2024");
    expect(formatValue("lastLogonTimestamp", ["0"])).toBe("Never");
  });
  it("annotates userAccountControl", () => {
    expect(formatValue("userAccountControl", ["514"])).toContain("Disabled");
  });
  it("joins multi-valued attributes", () => {
    expect(formatValue("memberOf", ["a", "b"])).toBe("a; b");
  });
  it("returns empty string for missing values", () => {
    expect(formatValue("cn", undefined)).toBe("");
  });
});

describe("csvValue", () => {
  it("renders FILETIME as ISO by default and raw when asked", () => {
    expect(csvValue("pwdLastSet", ["133516992000000000"])).toBe("2024-02-06T13:20:00.000Z");
    expect(csvValue("pwdLastSet", ["133516992000000000"], "; ", "raw")).toBe("133516992000000000");
    expect(csvValue("pwdLastSet", ["0"])).toBe("");
  });
  it("joins multi-values with the given separator", () => {
    expect(csvValue("memberOf", ["a", "b"], " | ")).toBe("a | b");
  });
});
