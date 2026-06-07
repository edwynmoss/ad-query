import { describe, it, expect } from "vitest";
import { buildCsv, DEFAULT_CSV_OPTIONS } from "./csv";

const entries: any = [
  { dn: "CN=Jane,OU=Sales,DC=x", attributes: { cn: ["Jane Doe"], title: ["Manager, Sales"], lastLogonTimestamp: ["133516992000000000"] } },
  { dn: "CN=Bob,DC=x", attributes: { cn: ["Bob"], title: ["Eng"], lastLogonTimestamp: ["0"] } },
];

describe("buildCsv", () => {
  it("quotes values containing the delimiter or commas", () => {
    const csv = buildCsv(entries, ["cn", "title"], { ...DEFAULT_CSV_OPTIONS, bom: false });
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("dn,cn,title");
    expect(lines[1]).toBe('"CN=Jane,OU=Sales,DC=x",Jane Doe,"Manager, Sales"');
  });

  it("converts FILETIME columns and blanks the never-sentinel", () => {
    const csv = buildCsv(entries, ["lastLogonTimestamp"], { ...DEFAULT_CSV_OPTIONS, bom: false, includeDN: false });
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("2024-02-06T13:20:00.000Z");
    expect(lines[2]).toBe("");
  });

  it("respects includeHeader / includeDN", () => {
    const csv = buildCsv(entries, ["cn"], { ...DEFAULT_CSV_OPTIONS, bom: false, includeHeader: false, includeDN: false });
    expect(csv.split("\r\n")).toEqual(["Jane Doe", "Bob"]);
  });

  it("prepends a UTF-8 BOM when requested", () => {
    const csv = buildCsv(entries, ["cn"], { ...DEFAULT_CSV_OPTIONS, bom: true });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("supports a custom delimiter", () => {
    const csv = buildCsv(entries, ["cn", "title"], { ...DEFAULT_CSV_OPTIONS, bom: false, delimiter: ";" });
    expect(csv.split("\r\n")[0]).toBe("dn;cn;title");
  });
});
