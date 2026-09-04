import { describe, it, expect } from "vitest";
import { assessRisk } from "./risk";
import { fileTimeDaysAgo } from "./lastseen";

const dn = (g: string) => `CN=${g},CN=Users,DC=corp,DC=test`;
const recent = fileTimeDaysAgo(2);
const old = fileTimeDaysAgo(200);

describe("assessRisk", () => {
  it("flags a disabled privileged account as Critical", () => {
    const r = assessRisk({ userAccountControl: ["514"] /* normal+disabled */, memberOf: [dn("Domain Admins")] });
    expect(r.level).toBe("Critical");
    expect(r.flags.some((f) => /disabled but privileged/i.test(f.label))).toBe(true);
  });

  it("flags a privileged account inactive >90d as High", () => {
    const r = assessRisk({ userAccountControl: ["512"], memberOf: [dn("Backup Operators")], lastLogonTimestamp: [old] });
    expect(r.level).toBe("High");
    expect(r.flags.some((f) => /inactive/i.test(f.label))).toBe(true);
  });

  it("password-never-expires on a normal user is Medium", () => {
    const r = assessRisk({ userAccountControl: ["66048"] /* normal + don't expire passwd */, lastLogonTimestamp: [recent], manager: ["x"], department: ["IT"] });
    expect(r.level).toBe("Medium");
    expect(r.flags.some((f) => /password never expires/i.test(f.label))).toBe(true);
  });

  it("a healthy, active, managed account is Low", () => {
    const r = assessRisk({ userAccountControl: ["512"], lastLogonTimestamp: [recent], manager: ["CN=Boss"], department: ["Sales"] });
    expect(r.level).toBe("Low");
  });

  it("trusted-for-delegation is High", () => {
    const r = assessRisk({ userAccountControl: ["524800"], lastLogonTimestamp: [recent], manager: ["x"], department: ["IT"] });
    expect(r.flags.some((f) => /delegation/i.test(f.label))).toBe(true);
    expect(r.level).toBe("High");
  });

  it("is not-applicable on a non-AD object (no userAccountControl), not a false verdict", () => {
    // Generic LDAP person (no userAccountControl), must not emit hygiene flags
    // like "never logged in" / "no department" that read as a real assessment.
    const r = assessRisk({ uid: ["oldacct"], mail: ["x@y.test"], displayName: ["Former Employee"] });
    expect(r.notApplicable).toBe(true);
    expect(r.flags).toHaveLength(0);
  });

  it("does not flag 'no department' when only departmentNumber is set", () => {
    const r = assessRisk({ userAccountControl: ["512"], lastLogonTimestamp: [recent], manager: ["x"], departmentNumber: ["Sales"] });
    expect(r.flags.some((f) => /no department/i.test(f.label))).toBe(false);
  });
});
