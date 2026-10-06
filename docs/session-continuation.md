# Session cross-account continuation

Explicit **visible-history continuation** is a plugin-owned, lossy outgoing
Responses policy. It is not a new memory service or portable encrypted state.
Native Core and pi-ai already preserve replay signatures and reconstruct history;
their same-provider/API/model check does not establish Copilot account identity.

## Experience

The Credits account panel contains **Visible-history continuation**. New,
unseeded Sessions created after this feature's first successful activation default
on. Activation persists a bounded creation-time policy epoch using Settings CAS;
existing Sessions, seeded histories, forks and unknown birth evidence remain off.
Manage the global default in **Models → GitHub Copilot → Manage → Account management**.
Changing it affects only subsequently created Sessions. Session overrides
(on, off or creation-time default) persist across account changes and restarts.
No failed request is required first and no hourly confirmation is needed.

The enabled disclosure stays compact. Details contain the disable action.
Enable/disable changes affect future turns; the active turn retains its captured
policy and account. The UI distinguishes pending changes from the active policy.
Disabling does not undo answers; it may expose the original replay rejection on
later requests. When off, switching to a different account pauses for persistent
enable, keep off, or cancel. The ordinary UI no longer offers a next-turn-only
mode. An exact replay rejection offers **Enable visible-history continuation**
with the loss disclosure and Cancel when off; this saves the same persistent
Session policy. When already on, show status and diagnostic guidance, not another
authorization. It never automatically sends or retries; native Retry is separate.
The failure-evidence lifetime does not limit the persisted policy. Retain old
one-turn consent and temporary recovery Remote contracts for compatibility only;
the normal Client does not create these authorizations.

See the [approved account-management experience and mock](./account-management-experience.md).
On the currently pinned Core, direct Models navigation is not a public Client
service. Chat omits the nonfunctional management entry rather than accessing
private stores or replacing Settings.

## Loss and retained content

On each admitted managed Responses turn, the first normalized payload captures
fingerprints of pre-existing completed encrypted reasoning. Those exact items,
including summaries embedded inside them, are omitted from outgoing requests
throughout that turn. Newly generated reasoning remains available to subsequent
tool steps and native retries. A later turn treats the preceding turn's reasoning
as historical, even without an account change.

Visible user/assistant messages, native tool calls and result pairing, system/tool
definitions and disk history remain under their existing owners. No encrypted
content is decoded, copied to settings or converted into invented raw reasoning.
The policy does not claim which account issued an old item.

## Public integration and safety

`github-copilot.sessionContinuation` stores strict bounded entries containing
only Session ID, policy version, explicit enabled state and consent timestamp.
Legacy entries without enabled retain their prior true meaning.
`continuationDefaultHistory` stores chronological bounded `{enabled, changedAt}`
entries, never Session content. Native SettingsForms CAS,
hidden volatile owned-field projection and readback preserve other settings and
the active plugin fiber. A separate strict `githubCopilotSessionContinuation`
Remote uses explicit Agent lookup; temporary recovery descriptors remain intact.

Public `agent/request`, `session/event` and `agent/disposed` bind an in-memory
per-turn baseline to the exact initiating Session and request signal. The
published adapter/SDK's payload hook filters the normalized payload. Only
`github-copilot-preview` Responses chat calls participate. Classifier, compaction,
unbound requests and other protocols remain native. Cold mid-turn recovery
without a first-step boundary fails explicitly.

Explicit manual summary recovery is separate: `/copilot-compact visible-history`
authorizes only one selected-engine operation, never inherited chat consent.
See [summary recovery](./manual-compaction-recovery.md#explicit-visible-history-summary-recovery).

The filter scans at most 65536 top-level input items and 4096 reasoning items
(including duplicates). Only encrypted reasoning is hashed, with an aggregate
64 Mi UTF-16-code-unit processing bound per invocation and 64 Ki-code-unit chunks
that yield to cancellation and turn revocation. These are plugin work bounds,
not supplier byte/token limits. Ordinary tool output, images, nested content,
system and tool definitions are neither traversed nor serialized by this filter;
there is no whole-request 16 MiB continuation cap. Failed, cancelled, overlapping
or revoked processing cannot partially initialize the baseline. Unsupported
reasoning, malformed settings, missing boundaries and exhausted work bounds
produce named diagnostics, not partial filtering or guessed success.
Credentials, account entitlement and model capabilities remain independently guarded.

Native retry normalization retains raw reference-restoration evidence but records
the final filtered bytes for exact 408 matching. No new retry loop is introduced.
Input admission still precedes payload filtering: this is not an oversized-context,
quota, upload-timeout, compaction or native context-meter repair.
Actual token pressure still uses the initiating Agent's enabled native compaction
engine and bounded recovery: commit the native summary, rebuild the request, then
apply continuation. A continuation work-bound error is not relabeled as context
overflow. Disabled automatic compaction, missing engines, cancellation, failed or
insufficient summaries remain explicit limitations, not permission to trim history.

## Evidence limits

Synthetic account transitions, source/Host/UI tests and exact-source native
gateway/persistence fixtures are distinct from real supplier acceptance.
The native compaction fixture covers first-step overflow and continuing-step
prevention with Auto, a durable in-memory replacement, rebuilt visible history
and synthetic historical reasoning larger than 16 MiB. It uses an external-model
double; it does not prove real supplier acceptance or recovery of a live Session.
Publication, installation, loaded runtime and controlled live A-B-B-A success
must be reported separately. Enabling this product mode is not authorized by
implementing it; live existing Sessions still require explicit loss consent.
The default-on creation policy is disclosed in account controls and can be
disabled globally or overridden per Session. Source tests do not establish live
default acceptance or real cross-account transport.
