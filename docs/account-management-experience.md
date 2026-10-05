# Copilot account management and continuation experience

Approved interaction reference: [standalone mock](./mockups/copilot-account-management.html).
Open the HTML locally; append `?scenario=off-switch` to start with continuation
disabled and an account switch awaiting confirmation. All accounts, quota,
authorization, messages and model availability in this mock are synthetic.
It performs no network requests and persists no credentials or settings.

## Chat: quick selection, not a second settings page

The Credits control opens a compact current-account summary and Switch button.
Do not render all saved accounts until Switch is opened. The selector supports
search, bounded scrolling, following the global account and adding an account.
Adding an account does not select it. Quota is account billing-cycle data, not
context occupancy or Session cost; missing and pooled data retain their semantics.

Selection applies to subsequent turns of the viewed Session. An active turn
keeps its admitted account and policy. Save failures retain their real uncertainty
and never imply that a change succeeded. Session explicit choices do not change
other Sessions or the global default.

The same panel includes a collapsible continuation policy and a single
"Manage accounts and models" entry. Full management belongs in Models.
Opening and closing Settings must not discard the composer draft or change the
selected Session. Direct navigation and automatic expansion depend on published
navigation APIs; absent support requires a named diagnostic and truthful manual
navigation instructions, not parent DOM manipulation.

## Models: one Manage disclosure, two responsibilities

The existing native Settings layout and provider controls remain. The collapsed
Copilot contribution shows current default identity, model status, cache age and
one Manage button. Manage expands:

- Account management: current default account, Switch/search/add, identity
  refresh, reauthorization, guarded removal, and new-Session continuation default.
- Model preferences: cross-account shared exclusions, model search and filters,
  account-specific availability, discovery diagnostics and model refresh.

Removal requires explicit confirmation. It removes only locally saved account
authorization, not GitHub-side access, conversations or shared model preferences.
Preserve existing canonical/default/in-use removal guards; do not silently choose
another account.

Model preferences are shared by exact model ID. Availability and capability
evidence remain account-specific. Missing models retain saved preferences;
returning models reuse them without becoming selected. Newly discovered models
are enabled unless excluded, but must satisfy authenticated metadata and admission
checks. Unknown/stale availability is not verified availability or definitive
absence. Do not discover every account solely to render a union catalog.
Fixed unavailable selections require explicit user correction; Auto uses only
eligible unexcluded models of the admitted account.

## Continuation and explicit-off recovery

The approved default is lossy visible-history continuation enabled for new
Sessions, with the loss disclosed beside the control. Existing Sessions and
seeded/forked histories must not silently inherit a new loss authorization.
Global changes do not retroactively rewrite a Session's captured initial policy.
Session overrides, including explicit off, persist and are reversible.

Every new admitted turn omits pre-existing encrypted reasoning items and their
embedded summaries, including on the same account. Visible messages, tool
calls/results and stored history remain unchanged. Current-turn reasoning stays
available for tool steps and native retries. This does not solve quota, HTTP 408
or oversized context and does not guarantee supplier acceptance.

When continuation is off and the user switches accounts, stop before saving the
selection and disclose the potential replay risk. Offer persistent enable and
switch, next-turn-only enable and switch, keep off and switch, or cancel.
Account differences alone do not prove supplier rejection. Never guess encrypted
item origin or silently filter history.

After an exact supplier replay rejection, retain the native failed turn and
surface persistent enable or next-turn-only authorization plus full management
navigation. Authorization never sends or retries. The user explicitly retries
the task through the native mechanism. Mock assistant answers are demonstrations,
not evidence of real cross-account success. Do not fabricate durable messages,
errors, replay or assistant content to imitate the mock.

## Theme and accessibility

Use native theme tokens for surfaces, text, borders, focus and errors. Native
select popup options must remain readable in dark and light themes; do not inherit
light popup backgrounds with dark-theme white text. Search and long account lists
must remain keyboard-operable, bounded and usable on narrow viewports. Explicit
loading, unknown, stale, failed-save and cancellation states are required.

## Implementation status

This document records the approved target, not a release or runtime attestation.
Implementation, native gateway/settings persistence, request admission,
dark/light interaction checks and required CI must qualify it before delivery.
