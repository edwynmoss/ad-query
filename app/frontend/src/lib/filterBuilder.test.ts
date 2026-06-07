import { describe, it, expect } from "vitest";
import { escapeLdapValue, compileCondition, compileConditions, combineAnd, isConditionValid, Condition } from "./filterBuilder";

const c = (over: Partial<Condition>): Condition => ({ id: "x", attribute: "cn", operator: "eq", value: "v", ...over });

describe("escapeLdapValue (RFC 4515)", () => {
  it("escapes the special characters", () => {
    expect(escapeLdapValue("a*b(c)d\\e")).toBe("a\\2ab\\28c\\29d\\5ce");
  });
  it("leaves ordinary text alone", () => {
    expect(escapeLdapValue("Jane Doe")).toBe("Jane Doe");
  });
});

describe("compileCondition", () => {
  it("builds each operator correctly", () => {
    expect(compileCondition(c({ operator: "eq", value: "Sales" }))).toBe("(cn=Sales)");
    expect(compileCondition(c({ operator: "neq", value: "Sales" }))).toBe("(!(cn=Sales))");
    expect(compileCondition(c({ operator: "present" }))).toBe("(cn=*)");
    expect(compileCondition(c({ operator: "contains", value: "ale" }))).toBe("(cn=*ale*)");
    expect(compileCondition(c({ operator: "startswith", value: "Sa" }))).toBe("(cn=Sa*)");
    expect(compileCondition(c({ operator: "endswith", value: "es" }))).toBe("(cn=*es)");
    expect(compileCondition(c({ attribute: "userAccountControl", operator: "bitand", value: "2" })))
      .toBe("(userAccountControl:1.2.840.113556.1.4.803:=2)");
  });
  it("escapes the value", () => {
    expect(compileCondition(c({ operator: "eq", value: "a)b" }))).toBe("(cn=a\\29b)");
  });
});

describe("compileConditions", () => {
  it("returns empty for no valid conditions", () => {
    expect(compileConditions([], "and")).toBe("");
    expect(compileConditions([c({ attribute: "" })], "and")).toBe("");
  });
  it("returns a bare filter for a single condition", () => {
    expect(compileConditions([c({ value: "x" })], "and")).toBe("(cn=x)");
  });
  it("wraps multiple in & / |", () => {
    const two = [c({ attribute: "cn", value: "x" }), c({ attribute: "sn", value: "y" })];
    expect(compileConditions(two, "and")).toBe("(&(cn=x)(sn=y))");
    expect(compileConditions(two, "or")).toBe("(|(cn=x)(sn=y))");
  });
});

describe("isConditionValid", () => {
  it("requires an attribute, and a value unless the operator is value-less", () => {
    expect(isConditionValid(c({ attribute: "", value: "x" }))).toBe(false);
    expect(isConditionValid(c({ operator: "eq", value: "" }))).toBe(false);
    expect(isConditionValid(c({ operator: "present", value: "" }))).toBe(true);
  });
});

describe("combineAnd", () => {
  it("layers extra conditions onto a base filter", () => {
    expect(combineAnd("(objectClass=user)", "(dept=Sales)")).toBe("(&(objectClass=user)(dept=Sales))");
  });
  it("returns whichever side is non-empty", () => {
    expect(combineAnd("(objectClass=user)", "")).toBe("(objectClass=user)");
    expect(combineAnd("", "(dept=Sales)")).toBe("(dept=Sales)");
  });
});
