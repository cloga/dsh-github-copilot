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
enable, next-turn-only authorization, keep off, or cancel. Next-turn authorization
is consumed at the next managed turn admission, includes its native retries, can
be revoked beforehand or by changing the Session policy, and is lost on Host restart. It never automatically sends
or retries. An exact replay rejection also exposes these authorization controls
beside recovery guidance; retry remains a separate native user action.

See the [approved account-management experience and mock](./account-management-experience.md).
On the currently pinned Core, direct Models navigation is not a public Client
service. Chat provides manual Settings → Models → GitHub Copilot → Manage
instructions rather than accessing private stores or replacing Settings.

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

The fingerprint baseline is bounded to 4096 distinct items, 65536 traversed
values, depth 64 and 16 MiB serialized payload. Unsupported reasoning, malformed
settings, missing boundaries and exhausted limits produce named diagnostics,
not partial filtering or guessed success. Credentials, account entitlement,
model capabilities and cancellation remain independently guarded.

Native retry normalization retains raw reference-restoration evidence but records
the final filtered bytes for exact 408 matching. No new retry loop is introduced.
Input admission still precedes payload filtering: this is not an oversized-context,
quota, upload-timeout, compaction or native context-meter repair.

## Evidence limits

Synthetic account transitions, source/Host/UI tests and exact-source native
gateway/persistence fixtures are distinct from real supplier acceptance.
Publication, installation, loaded runtime and controlled live A-B-B-A success
must be reported separately. Enabling this product mode is not authorized by
implementing it; live existing Sessions still require explicit loss consent.
The default-on creation policy is disclosed in account controls and can be
disabled globally or overridden per Session. Source tests do not establish live
default acceptance or real cross-account transport.
