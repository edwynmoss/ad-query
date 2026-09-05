# AD Query, UX principles (research-backed)

Distilled from a verified deep-research pass (NN/g heuristics, Microsoft Win32
UX Guide, Fluent 2, Microsoft Design/Azure, Empty-State & Error-Message
guidelines). 25/25 claims survived 3-vote adversarial verification. We rework
each journey against this rubric.

## The pillars (in priority order)

1. **Visibility of system status**, always tell the user what's happening:
   connection state ("are we connected, as whom?"), loading states, progress
   for long operations, and immediate feedback that an action registered. This
   is the single most load-bearing principle. _(NN/g #1)_
2. **Plain language first, progressive disclosure to ONE advanced level** 
   speak the user's words, not LDAP jargon. Plain-language search at level 1;
   raw filter syntax / DN / scope at a single "advanced" level 2. **Never nest
   past two levels.** Guard discoverability, don't hide things so well users
   think they don't exist; don't flicker UI in/out (feels unstable). _(NN/g
   #2, Progressive Disclosure; MS Win32 UX Guide)_
3. **Disciplined errors**, plain language, **no raw codes in the primary
   message** (codes go in an expandable "Details" for support), say what
   happened + why + the remedy, one cause-specific message per known failure.
   _(NN/g #9, Error-Message Guidelines; MS Win32 Error Guide)_
4. **Severity-scaled, proximate presentation**, show the message next to its
   source. Inline / banner / toast for minor; modal only for severe/blocking.
   Never color alone (≈350M people have CVD). Warning & error banners must
   carry an action. _(NN/g Error Guidelines; Fluent 2 MessageBar)_
5. **Cross-journey consistency**, users/groups/computers/license views and the
   local↔cloud join share one layout, control placement, and detail-pane
   pattern (the Azure model: learn one small set of rules). _(MS Design/Azure)_
6. **Rich empty states**, never a blank area. Communicate status, distinguish
   "no data" from "still loading" from "errored", and give a direct next step
   ("Run a query", "Sign in", "Learn more"). _(NN/g Empty States)_

## Per-journey checklist

1. **Connect / sign-in**, persistent connection badge (done: masthead). One
   plain-language path; advanced (DN/port/own-app) disclosed once. Connection &
   OAuth failures → plain message + remedy + code under Details.
2. **Search & query**, plain-language search is the obvious primary path;
   structured filter builder + raw LDAP + base DN/scope are the *single*
   advanced level. Make it legible how type + search + filters + location
   combine. No 3-deep nesting.
3. **Results & inspect**, consistent grid; status pills; detail pane opens for
   the "substantial/complex" attribute/ACL view (separate surface, not inline).
4. **Bulk**, file → detected key (status) → run with progress → per-row
   pass/fail summary → export. Partial failures stated plainly, not swallowed.
5. **Reports & enrichment (local ↔ 365 join)**, make the join model and its
   prerequisites obvious: it matches AD accounts to 365 by UPN/email; show what
   matched vs. didn't and why (provenance), and that 365 must be connected.
6. **Empty / loading / error / status**, apply pillars 1, 3, 4, 6 everywhere;
   replace blank/zero/cryptic states with status + cause + next step.

## Open questions the evidence didn't settle (decide by inference + testing)
- Concrete OAuth "are we connected?" signalling beyond a badge (token-expiry warnings, silent re-auth).
- Grid patterns for large result sets (column mgmt, density, virtualization), we already virtualize.
- Join/provenance UX for partial matches & stale cloud data.
- Bulk partial-failure UX specifics (per-row status, downloadable error CSV, retry-failed-only).
