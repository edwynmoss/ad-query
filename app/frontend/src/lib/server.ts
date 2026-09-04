// A directory address carries its own transport: port 636 (or an explicit
// ldaps:// prefix) means LDAPS, everything else is plain LDAP, which is what
// AD shops run. So the connection form needs a single "Server" field, not a
// port box and an encryption switch.
export interface ServerTarget {
  host: string;
  port: number;
  encryption: "none" | "ldaps";
}

export function parseServer(input: string): ServerTarget {
  let s = input.trim();
  let scheme: string | null = null;
  const m = s.match(/^(ldaps?):\/\//i);
  if (m) { scheme = m[1].toLowerCase(); s = s.slice(m[0].length); }
  s = s.replace(/\/.*$/, ""); // strip any path

  let host = s;
  let port = 389;
  const colon = s.lastIndexOf(":");
  if (colon > -1) {
    const p = parseInt(s.slice(colon + 1), 10);
    if (!isNaN(p)) { host = s.slice(0, colon); port = p; }
  }

  const encryption: "none" | "ldaps" =
    scheme === "ldaps" ? "ldaps" : scheme === "ldap" ? "none" : port === 636 ? "ldaps" : "none";

  return { host: host || "localhost", port, encryption };
}
