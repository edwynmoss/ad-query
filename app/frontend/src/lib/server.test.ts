import { describe, it, expect } from "vitest";
import { parseServer } from "./server";

describe("parseServer", () => {
  it("defaults to plain LDAP on 389 for a bare host", () => {
    expect(parseServer("dc01.contoso.com")).toEqual({ host: "dc01.contoso.com", port: 389, encryption: "none" });
  });
  it("keeps an explicit non-standard port as plain", () => {
    expect(parseServer("localhost:3389")).toEqual({ host: "localhost", port: 3389, encryption: "none" });
  });
  it("infers LDAPS from port 636", () => {
    expect(parseServer("dc01.contoso.com:636")).toEqual({ host: "dc01.contoso.com", port: 636, encryption: "ldaps" });
  });
  it("honours an explicit ldaps:// scheme on any port", () => {
    expect(parseServer("ldaps://dc01.contoso.com")).toEqual({ host: "dc01.contoso.com", port: 389, encryption: "ldaps" });
  });
  it("honours an explicit ldap:// scheme even on 636", () => {
    expect(parseServer("ldap://dc01.contoso.com:636")).toEqual({ host: "dc01.contoso.com", port: 636, encryption: "none" });
  });
  it("strips a trailing path and trims whitespace", () => {
    expect(parseServer("  dc01.contoso.com:636/dc=x  ")).toEqual({ host: "dc01.contoso.com", port: 636, encryption: "ldaps" });
  });
  it("falls back to localhost for empty input", () => {
    expect(parseServer("")).toEqual({ host: "localhost", port: 389, encryption: "none" });
  });
});
