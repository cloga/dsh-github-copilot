# Copilot account management and continuation experience

Approved account switching reference: [dropdown mock](./mockups/copilot-account-dropdown.html).
The [complete continuation mock](./mockups/copilot-account-management.html) retains
the earlier search-form presentation as historical context; the dropdown replaces it.
Open the HTML locally; append `?scenario=off-switch` to start with continuation
disabled and an account switch awaiting confirmation. All accounts, quota,
authorization, messages and model availability in this mock are synthetic.
It performs no network requests and persists no credentials or settings.

## Chat: quick selection, not a second settings page

The Credits control opens a compact current-account summary and Switch button.
Do not render all saved accounts until Switch is opened. A compact anchored dropdown
marks the current choice, supports bounded internal scrolling, following the global
account and adding an account. Do not add an account search field or repeat Switch
buttons per row. Escape closes only the dropdown and restores its trigger; arrows,
Home and End navigate enabled options. Outside interaction dismisses the list.
Adding an account does not select it. Quota is account billing-cycle data, not
context occupancy or Session cost; missing and pooled data retain their semantics.

Selection applies to subsequent turns of the viewed Session. An active turn
keeps its admitted account and policy. Save failures retain their real uncertainty
and never imply that a change succeeded. Session explicit choices do not change
other Sessions or the global default.

The same panel includes a collapsible continuation policy. Full management belongs
in Models; show a "Manage accounts and models" entry only with a working public
navigation callback. Do not show a disabled link or unavailable-navigation paragraph.
Opening and closing Settings must not discard the composer draft or change the
selected Session. Direct navigation and automatic expansion depend on published
navigation APIs; absent support leaves navigation to ordinary Settings, never
parent DOM manipulation or a nonfunctional entry.

## Models: one Manage disclosure, two responsibilities

The existing native Settings layout and provider controls remain. The collapsed
Copilot contribution shows current default identity, model status, cache age and
one Manage button. Manage expands:

- Account management: current default account, Switch dropdown/add, identity
  refresh, reauthorization, guarded removal, and new-Session continuation default.
- Model preferences: cross-account shared exclusions, model search and filters,
  account-specific availability, discovery diagnostics and model refresh.

Removal requires explicit confirmation. It removes only locally saved account
authorization, not GitHub-side access, conversations or shared model preferences.
Preserve existing canonical/default/in-use removal guards; do not silently choose
another account.

Keep saved-account reauthorization/removal in a separate collapsed management
disclosure, not in the switching menu. The dropdown remains an account choice,
not another settings page. Global switching retains its explicit confirmation;
Chat retains the continuation confirmation when the current policy is off.

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
switch, keep off and switch, or cancel. Do not offer next-turn-only authorization.
Account differences alone do not prove supplier rejection. Never guess encrypted
item origin or silently filter history.

After an exact supplier replay rejection, retain the native failed turn and
surface the same persistent Session policy: when off, disclose loss and offer
Enable/Cancel; when on, show diagnostic guidance without repeated authorization.
Do not show duration radios or unavailable Models navigation. Failure-evidence
expiry does not disable the persistent policy. Authorization never sends or retries. The user explicitly retries
the task through the native mechanism. Mock assistant answers are demonstrations,
not evidence of real cross-account success. Do not fabricate durable messages,
errors, replay or assistant content to imitate the mock.

## Theme and accessibility

Use native theme tokens for surfaces, text, borders, focus and errors. Native
select popup options must remain readable in dark and light themes; do not inherit
light popup backgrounds with dark-theme white text. Dropdowns and long account lists
must remain keyboard-operable, bounded and usable on narrow viewports. Explicit
loading, unknown, stale, failed-save and cancellation states are required.

The shared Models/Chat account dropdown must composite translucent native menu
tokens over an opaque system Canvas, so underlying settings and quota text never
bleed through. Dropdown and Credits panel elevation uses a dark shadow, not
CanvasText (which becomes a white glow in dark mode). Theme acceptance must
include translucent tokens, both themes/surfaces and narrow viewports; fixtures
that replace the token with opaque Canvas alone cannot establish this behavior.

## Implementation status

This document records the approved target, not a release or runtime attestation.
Implementation, native gateway/settings persistence, request admission,
dark/light interaction checks and required CI must qualify it before delivery.
