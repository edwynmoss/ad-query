import { describe, it, expect } from "vitest";
import { parseBuffer, detectKey, chunkFilter, chunk, rowsToCsv } from "./bulk";

const enc = (s: string) => new TextEncoder().encode(s);

describe("parseBuffer (CSV)", () => {
  it("reads headers and rows, trimming blanks", () => {
    const sheet = parseBuffer(enc("UPN,Department\nalice@corp.com,Sales\nbob@corp.com,IT\n"));
    expect(sheet.headers).toEqual(["UPN", "Department"]);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]).toEqual({ UPN: "alice@corp.com", Department: "Sales" });
  });
});

describe("detectKey", () => {
  it("matches a UPN column by header name", () => {
    const sheet = parseBuffer(enc("UserPrincipalName,Dept\nalice@corp.com,Sales\n"));
    expect(detectKey(sheet)).toEqual({ column: "UserPrincipalName", matchAttr: "userPrincipalName" });
  });
  it("matches a username column to sAMAccountName by header name", () => {
    const sheet = parseBuffer(enc("Username,Dept\nalice,Sales\n"));
    expect(detectKey(sheet)).toEqual({ column: "Username", matchAttr: "sAMAccountName" });
  });
  it("falls back to value sniffing: @ values → userPrincipalName", () => {
    const sheet = parseBuffer(enc("col1,col2\nalice@corp.com,x\nbob@corp.com,y\n"));
    expect(detectKey(sheet).matchAttr).toBe("userPrincipalName");
  });
  it("falls back to value sniffing: plain tokens → sAMAccountName", () => {
    const sheet = parseBuffer(enc("col1,col2\nalice,x\nbob,y\n"));
    expect(detectKey(sheet).matchAttr).toBe("sAMAccountName");
  });
});

describe("chunkFilter", () => {
  it("builds an OR filter ANDed with the base, escaping values", () => {
    expect(chunkFilter("(objectClass=user)", "sAMAccountName", ["a", "b)"]))
      .toBe("(&(objectClass=user)(|(sAMAccountName=a)(sAMAccountName=b\\29)))");
  });
  it("returns empty for no values", () => {
    expect(chunkFilter("(objectClass=user)", "sAMAccountName", ["", "  "])).toBe("");
  });
});

describe("chunk", () => {
  it("splits into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("rowsToCsv", () => {
  it("emits columns in order and quotes when needed", () => {
    const csv = rowsToCsv(["UPN", "Status"], [{ UPN: "a@x", Status: "Found" }, { UPN: "b,c", Status: "Not found" }], false);
    expect(csv.split("\r\n")).toEqual(["UPN,Status", "a@x,Found", '"b,c",Not found']);
  });
});
