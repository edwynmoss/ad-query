import { describe, it, expect } from "vitest";
import { friendlyError } from "./friendlyError";

describe("friendlyError", () => {
  it("maps a connection-refused error to a reachability message + remedy, keeping raw", () => {
    const raw = 'dial tcp [::1]:389: connectex: No connection could be made because the target machine actively refused it.';
    const f = friendlyError(raw);
    expect(f.title).toMatch(/couldn't reach the directory/i);
    expect(f.remedy).toMatch(/port/i);
    expect(f.raw).toBe(raw);
  });

  it("maps invalid credentials (LDAP 49)", () => {
    expect(friendlyError("LDAP Result Code 49 \"Invalid Credentials\"").title).toMatch(/rejected/i);
  });

  it("maps AADSTS50011 redirect mismatch", () => {
    expect(friendlyError("AADSTS50011: The redirect URI ... does not match").title).toMatch(/sign-in app configuration/i);
  });

  it("maps admin-consent (AADSTS65001)", () => {
    expect(friendlyError("AADSTS65001: The user or administrator has not consented").remedy).toMatch(/admin/i);
  });

  it("falls back for unknown errors but preserves the raw text", () => {
    const f = friendlyError("kaboom 17");
    expect(f.title).toBe("Something went wrong.");
    expect(f.raw).toBe("kaboom 17");
  });

  it("reads Error objects and empty input", () => {
    expect(friendlyError(new Error("i/o timeout")).title).toMatch(/didn't respond/i);
    expect(friendlyError(undefined).raw).toBe("Unknown error.");
  });
});
