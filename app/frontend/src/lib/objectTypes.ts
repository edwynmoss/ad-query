// Curated object-type presets. Each maps a friendly type to an LDAP filter and
// a sensible default attribute set. Works for both AD and the OpenLDAP test
// directory (filters fall back to generic objectClasses when AD-specific ones
// are absent).

export interface ObjectType {
  key: string;
  label: string;
  // Filter for AD-style directories.
  adFilter: string;
  // Filter for generic LDAP (OpenLDAP test dir).
  ldapFilter: string;
  defaultAttributes: string[];
  // Default columns for generic LDAP, where AD-only attributes (sAMAccountName,
  // userAccountControl, lastLogonTimestamp…) don't exist. Falls back to
  // defaultAttributes when omitted.
  ldapAttributes?: string[];
}

export const OBJECT_TYPES: ObjectType[] = [
  {
    key: "users",
    label: "Users",
    adFilter: "(&(objectCategory=person)(objectClass=user))",
    ldapFilter: "(objectClass=inetOrgPerson)",
    defaultAttributes: [
      "displayName",
      "sAMAccountName",
      "mail",
      "department",
      "userAccountControl",
      "lastLogonTimestamp",
    ],
    ldapAttributes: ["displayName", "uid", "mail", "title", "departmentNumber", "telephoneNumber"],
  },
  {
    key: "groups",
    label: "Groups",
    adFilter: "(objectClass=group)",
    ldapFilter: "(objectClass=groupOfNames)",
    defaultAttributes: ["cn", "description", "member"],
  },
  {
    key: "computers",
    label: "Computers",
    adFilter: "(objectClass=computer)",
    ldapFilter: "(objectClass=device)",
    defaultAttributes: ["cn", "operatingSystem", "description", "lastLogonTimestamp"],
    ldapAttributes: ["cn", "serialNumber", "description"],
  },
  {
    key: "ous",
    label: "OUs",
    adFilter: "(objectClass=organizationalUnit)",
    ldapFilter: "(objectClass=organizationalUnit)",
    defaultAttributes: ["ou", "description"],
  },
  {
    key: "any",
    label: "Any",
    adFilter: "(objectClass=*)",
    ldapFilter: "(objectClass=*)",
    defaultAttributes: ["cn", "objectClass"],
  },
];

export function filterFor(t: ObjectType, isAD: boolean): string {
  return isAD ? t.adFilter : t.ldapFilter;
}

// Default columns for a type against the connected directory. AD gets the
// AD-centric set; generic LDAP gets attributes that actually exist there.
export function defaultAttributesFor(t: ObjectType, isAD: boolean): string[] {
  return !isAD && t.ldapAttributes ? [...t.ldapAttributes] : [...t.defaultAttributes];
}

// Fallback common attributes for the picker when no schema is loaded yet.
export const COMMON_ATTRIBUTES: string[] = [
  "cn", "sn", "givenName", "displayName", "name", "description",
  "sAMAccountName", "userPrincipalName", "uid", "mail", "title",
  "department", "departmentNumber", "telephoneNumber", "mobile",
  "manager", "member", "memberOf", "objectClass", "objectCategory",
  "distinguishedName", "whenCreated", "whenChanged",
  "userAccountControl", "pwdLastSet", "accountExpires", "lastLogon",
  "lastLogonTimestamp", "badPwdCount", "lockoutTime", "operatingSystem",
  "operatingSystemVersion", "employeeNumber", "ou", "serialNumber", "owner",
];
