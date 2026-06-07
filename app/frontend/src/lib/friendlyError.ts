// Turn a raw backend/LDAP/OAuth error string into a plain-language message with
// an actionable remedy, keeping the raw text available for support. Follows the
// error-message guidance: no raw codes in the primary line, say what happened
// and how to fix it, one message per known cause.

export interface FriendlyError {
  title: string;       // plain-language what-happened
  remedy?: string;     // what to do about it
  raw: string;         // original text, shown under "Details"
}

interface Rule { test: RegExp; title: string; remedy?: string }

const RULES: Rule[] = [
  // --- Directory / LDAP connection ---
  {
    test: /connectex|connection (could not|refused)|no connection could be made|dial tcp|actively refused/i,
    title: "Couldn't reach the directory server.",
    remedy: "Check the server address and that the directory is listening on that port (LDAP is usually 389, LDAPS 636).",
  },
  {
    test: /i\/o timeout|deadline exceeded|timeout|timed out/i,
    title: "The server didn't respond in time.",
    remedy: "Check the address and your network connection, then try again.",
  },
  {
    test: /no such host|lookup .* no such host|server misbehaving/i,
    title: "That server name couldn't be found.",
    remedy: "Check the spelling of the server address (e.g. dc01.contoso.com).",
  },
  {
    test: /result code 49|invalid credentials|data 52e|acceptsecuritycontext|1326/i,
    title: "Sign-in was rejected by the directory.",
    remedy: "Check the username and password. Use a UPN (you@contoso.com) or a full DN.",
  },
  {
    test: /result code 32|no such object/i,
    title: "That search location wasn't found.",
    remedy: "Pick a different location, or check the base DN under Filters → Location.",
  },
  {
    test: /certificate|x509|tls: |handshake|unknown authority|self.?signed/i,
    title: "Couldn't establish a secure (LDAPS) connection.",
    remedy: "If the server uses a self-signed certificate, tick “Accept self-signed certificate” and retry.",
  },
  // --- Microsoft 365 / Entra (AADSTS) ---
  {
    test: /AADSTS50011|redirect uri/i,
    title: "Microsoft 365 sign-in app configuration issue.",
    remedy: "The sign-in redirect didn't match. Try again; if it persists, use Advanced → your own app registration.",
  },
  {
    test: /AADSTS65001|AADSTS90008|consent|admin approval|not consented/i,
    title: "Microsoft 365 needs admin approval.",
    remedy: "Reading other users' licences/sign-ins requires a one-time admin consent for the tenant. Ask a Global Admin to approve it.",
  },
  {
    test: /AADSTS700016|application.*not found|unauthorized_client/i,
    title: "The Microsoft 365 sign-in app isn't available in this tenant.",
    remedy: "Use Advanced → enter your own tenant's app registration.",
  },
  {
    test: /AADSTS50058|AADSTS50079|AADSTS50076|interaction_required|expired|invalid_grant/i,
    title: "Your Microsoft 365 session expired.",
    remedy: "Sign in to Microsoft 365 again (the ☁ button).",
  },
  {
    test: /state mismatch/i,
    title: "Sign-in couldn't be verified.",
    remedy: "Start the Microsoft 365 sign-in again from the app.",
  },
];

export function friendlyError(input: unknown): FriendlyError {
  const raw = String((input as any)?.message ?? input ?? "").trim();
  for (const r of RULES) {
    if (r.test.test(raw)) return { title: r.title, remedy: r.remedy, raw };
  }
  return { title: "Something went wrong.", remedy: undefined, raw: raw || "Unknown error." };
}
