import { decodeUAC } from "./format";
import { combineLastSeen, daysSince } from "./lastseen";
import type { StatusTone } from "@/components/ui/status-badge";

// Turns raw AD attributes into plain-language risk flags + an overall rating.
// Pure (no I/O) so it's easy to unit-test and reuse anywhere a user's
// attributes are available.

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";
export interface RiskFlag { label: string; level: RiskLevel; reason: string }
export interface RiskAssessment { level: RiskLevel; flags: RiskFlag[] }

// Attributes the assessment reads — fetch these for the user being assessed.
export const RISK_ATTRS = [
  "userAccountControl", "lastLogonTimestamp", "lastLogon", "pwdLastSet",
  "accountExpires", "adminCount", "servicePrincipalName", "memberOf",
  "manager", "department",
];

// Default privileged groups (matched against memberOf DNs / used by the
// privileged-access review).
export const PRIVILEGED_GROUPS = [
  "Domain Admins", "Enterprise Admins", "Schema Admins", "Administrators",
  "Account Operators", "Server Operators", "Backup Operators", "Print Operators",
  "Group Policy Creator Owners", "DnsAdmins",
];
const PRIVILEGED = PRIVILEGED_GROUPS;

const ORDER: RiskLevel[] = ["Low", "Medium", "High", "Critical"];
const higher = (a: RiskLevel, b: RiskLevel): RiskLevel => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

// Map a risk level to a status-badge tone (shared by the inspector + reviews).
export const riskTone = (l: RiskLevel): StatusTone => (l === "Low" ? "neutral" : l === "Medium" ? "warning" : "critical");
export const riskRank = (l: RiskLevel): number => ORDER.indexOf(l);

const val = (attrs: Record<string, string[]>, k: string) => attrs[k]?.[0] ?? "";

// accountExpires: 0 or 0x7FFFFFFFFFFFFFFF (9223372036854775807) mean "never".
function expired(raw: string): boolean {
  if (!raw || raw === "0" || raw === "9223372036854775807") return false;
  const epoch = (BigInt(raw) - 116444736000000000n) / 10000n; // FILETIME → ms
  return Number(epoch) < Date.now();
}

export function assessRisk(attrs: Record<string, string[]>): RiskAssessment {
  const flags: RiskFlag[] = [];
  const add = (label: string, level: RiskLevel, reason: string) => flags.push({ label, level, reason });

  const uac = decodeUAC(val(attrs, "userAccountControl"));
  const disabled = uac.includes("Disabled");
  const privileged = (attrs.memberOf ?? []).some((dn) =>
    PRIVILEGED.some((g) => dn.toLowerCase().includes(`cn=${g.toLowerCase()},`) || dn.toLowerCase().includes(`cn=${g.toLowerCase()}`)),
  );
  const hasSPN = (attrs.servicePrincipalName ?? []).length > 0;

  const llt = val(attrs, "lastLogonTimestamp") || val(attrs, "lastLogon");
  const seen = combineLastSeen(llt && llt !== "0" ? llt : undefined);
  const idle = daysSince(seen.date);
  const neverLoggedIn = seen.date === null;

  // --- Privileged-account combinations (highest severity) ---
  if (privileged && disabled) add("Disabled but privileged", "Critical", "Account is disabled yet still a member of a privileged group — remove the privileged access.");
  if (privileged && !disabled && idle !== null && idle >= 90) add("Privileged & inactive", "High", `Member of a privileged group and not seen for ${idle} days — confirm the access is still required.`);
  if (privileged && uac.includes("Password never expires")) add("Privileged · password never expires", "High", "Privileged account whose password never expires — a high-value, long-lived credential.");
  if (privileged && !disabled && idle === null && neverLoggedIn) add("Privileged · never logged in", "High", "Privileged account with no recorded login.");

  // --- Configuration weaknesses ---
  if (uac.includes("Password not required")) add("Password not required", "High", "PASSWD_NOTREQD is set — the account can have a blank password.");
  if (uac.includes("Trusted for delegation")) add("Trusted for delegation", "High", "Unconstrained delegation — a known privilege-escalation risk.");
  if (hasSPN && uac.includes("Password never expires")) add("SPN · password never expires", "High", "Service account (has an SPN) with a non-expiring password — kerberoasting exposure.");
  if (uac.includes("Password never expires") && !privileged) add("Password never expires", "Medium", "Password is set to never expire.");

  // --- Activity / lifecycle ---
  if (!privileged && !disabled && idle !== null && idle >= 90) add("Stale account", "Medium", `Enabled but not seen for ${idle} days.`);
  if (neverLoggedIn && !privileged) add("Never logged in", "Medium", "No login has been recorded for this account.");
  if (uac.includes("Locked out")) add("Locked out", "Medium", "The account is currently locked.");
  if (expired(val(attrs, "accountExpires"))) add("Account expired", "Medium", "The account's expiry date has passed.");
  if (val(attrs, "adminCount") === "1" && !privileged) add("adminCount = 1", "Medium", "Was privileged at some point (adminCount stamped) but isn't in a privileged group now — verify.");
  if (hasSPN && !uac.includes("Password never expires")) add("Service account (SPN)", "Low", "Has a service principal name — treat as a service account.");

  // --- Hygiene ---
  if (!(attrs.manager ?? []).length) add("No manager", "Low", "No manager is set — ownership is unclear for access reviews.");
  if (!(attrs.department ?? []).length) add("No department", "Low", "No department is set.");

  const level = flags.reduce<RiskLevel>((acc, f) => higher(acc, f.level), "Low");
  return { level, flags };
}
