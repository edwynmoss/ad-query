// Plain-language names for LDAP/AD attributes, so the UI doesn't make users
// know raw attribute names. labelFor() falls back to the raw name for anything
// not in the map (power users still see the real attribute).

export const ATTR_LABELS: Record<string, string> = {
  displayname: "Display name",
  cn: "Full name",
  name: "Name",
  samaccountname: "Username",
  uid: "Username",
  userprincipalname: "Sign-in name (UPN)",
  mail: "Email",
  proxyaddresses: "Email aliases",
  givenname: "First name",
  sn: "Last name",
  initials: "Initials",
  title: "Job title",
  department: "Department",
  departmentnumber: "Department",
  company: "Company",
  manager: "Manager",
  directreports: "Direct reports",
  telephonenumber: "Phone",
  mobile: "Mobile",
  facsimiletelephonenumber: "Fax",
  description: "Description",
  useraccountcontrol: "Account status",
  lastlogontimestamp: "Last sign-in",
  lastlogon: "Last logon",
  whencreated: "Created",
  whenchanged: "Modified",
  pwdlastset: "Password last set",
  accountexpires: "Account expires",
  memberof: "Member of (groups)",
  member: "Members",
  employeenumber: "Employee number",
  employeeid: "Employee ID",
  physicaldeliveryofficename: "Office",
  streetaddress: "Street",
  l: "City",
  st: "State / province",
  postalcode: "Postal code",
  co: "Country",
  c: "Country code",
  objectclass: "Object type",
  objectcategory: "Object category",
  distinguishedname: "Distinguished name (DN)",
  operatingsystem: "Operating system",
  operatingsystemversion: "OS version",
  serialnumber: "Serial number",
  ou: "Organizational unit",
};

export function labelFor(attr: string): string {
  return ATTR_LABELS[attr.toLowerCase()] ?? attr;
}

// Curated, ordered list of broadly useful columns (raw attribute names). The
// picker filters this to what the connected directory actually has, so AD and
// plain-LDAP each show the relevant subset.
export const COMMON_COLUMNS: string[] = [
  "displayName", "cn", "sAMAccountName", "uid", "userPrincipalName", "mail",
  "givenName", "sn", "title", "department", "departmentNumber", "company",
  "manager", "telephoneNumber", "mobile", "physicalDeliveryOfficeName",
  "userAccountControl", "lastLogonTimestamp", "whenCreated", "memberOf",
  // employeeID is the AD-standard field; employeeNumber is the inetOrgPerson/
  // OpenLDAP one. The picker shows whichever the connected schema actually has.
  "description", "employeeID", "employeeNumber", "operatingSystem",
];
