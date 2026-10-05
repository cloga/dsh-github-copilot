# Copilot compatibility acceptance

This change is not complete when a GPT-6-only prototype works or a PR is merely opened. The requested result is a plugin-only, data-driven Copilot integration, including public reasoning summaries, followed by verified delivery and local upgrade.

## Scope

Follow the [plugin-only boundary](../AGENTS.md#plugin-only-implementation-boundary). Reuse the published DSH/pi-ai adapter and OAuth interfaces. Do not modify Core, dependency artifacts, private registries, or shared upstream catalogs. A plugin-owned Copilot route may serve multiple account-advertised models; this is configuration and lifecycle integration, not another implementation of generic wire serialization.

## Required behavior

1. **Account-driven discovery.** Read the provider's model metadata with bounded requests and account-scoped cache lifetime. A new model with sufficient supported metadata must not require another model-ID patch or plugin release. A new model name alone is insufficient evidence of its protocol or capabilities.
2. **Protocol selection from evidence.** Use advertised `supported_endpoints` for Responses, Chat Completions, or Anthropic Messages. Native pi catalog choices may be retained only when compatible with the advertised endpoints. Do not infer a protocol from a GPT, Gemini, Claude, or other name prefix. Missing or unsupported metadata produces an explicit diagnostic, not a guessed route.
3. **Capabilities stay distinct.** Preserve context, input and output limits separately; do not invent large limits or unsupported reasoning levels. Respect disabled/unconfigured policy, picker eligibility and tool/stream support. Provider metadata does not authorize changing account policy.
4. **One credential lifecycle.** All plugin-owned routes share the canonical Host-only Copilot OAuth record. Model discovery, refresh and in-flight requests remain bound to the same account generation. Account switches, entitlement removal, disposal and stale callbacks must fail closed without copying credentials or changing other providers.
5. **Thinking is included.** Preserve public summary deltas and final-only summaries without duplicate text. Validate selected effort and keep native default semantics. Empty or encrypted-only responses must not become fabricated explanations. Native replay, images and file projection retain their owning adapter's behavior; opaque replay is not displayed or rewritten into raw reasoning text.
6. **Current pi 0.87.1 compatibility.** The original acceptance target was 0.85.1; official DSH rc.2 now depends on `^0.87.1`. Pin and test the exact published SDK version, not just a GitHub release label. Its Copilot GPT-6 catalog protocol must not override contrary provider endpoint evidence. An updated catalog entry is not sufficient grounds to retire a correction if the protocol/capabilities are still wrong.

## Regression evidence

- Include GPT-6 Astra, Gemini 3.8 Flash and GPT-5.6 Sol Fast metadata fixtures, plus arbitrary unseen IDs on all three supported protocols. The unseen-ID cases must pass without adding those IDs to implementation tables.
- Cover missing/conflicting endpoints, missing/invalid limits, duplicate conflicting IDs, explicit denial, stale account snapshots, unsupported reasoning labels, unknown fields and hostile extra getters.
- Exercise real published adapter/SDK code against local synthetic HTTP for all supported protocols, including tools, public summaries, two-turn opaque replay, images and interruption/retry paths. Synthetic results are not claims of live account availability.
- Verify managed request-body timeout guidance only for the observed HTTP `408`, exact `user_request_timeout` code and request-body message. Bound clone reads to 8 KiB/250 ms, retain the original native response, and expose only fixed guidance plus final string-body UTF-8 bytes. Preserve failure code, retry metadata, cancellation, unchanged retry payloads and independent dispatches. Do not reclassify 408 as overflow, invent a safe byte threshold, change client timeouts, refresh OAuth, compact automatically or promise elimination of upstream failures.
- Verify byte-aware managed HTTP/SSE liveness through unchanged published and tagged adapters: heartbeat bytes may cross the original semantic deadline before actual output, but endless heartbeat-only output must hit the bounded native deadline. Real header/body stalls retain the original interval and a dispatch-local TIMEOUT; consumer think time, caller/credential cancellation, exact bytes, parser ownership and one native wire attempt remain unchanged. Explicit WebSocket/auto and opt-out retain native-only behavior. Preserve the 20 MiB native image budget by default; explicit smaller budgets must use native offload and retain mapped read-only paths/history, never hidden trimming or a claimed supplier threshold. These synthetic cases do not attest production heartbeat activity or cure HTTP 408.
- Run source/test typechecks, complete repository tests, built Host/Client/Remote smoke, archive verification, and relevant unchanged-Core compatibility fixtures. Do not suppress type or test failures to bridge incompatible SDK versions.

## Explicit public-interface limits

- The published Core model-info contract exposes combined context capacity, not a separate prompt-token budget. The managed route retains truthful capacities and adds provider-scoped estimated admission (`INPUT_LIMIT_ESTIMATED_GUARD`), with optional earlier local pressure using existing stock recovery. This is not exact provider token counting or native dual-limit metadata support. Preserve explicit summary output caps and resolved reasoning; unsupported low-effort controls are not guessed. Already oversized manual summaries still fail without silent trimming or chunking. See [compaction budgets and acceptance boundaries](./copilot-compaction.md); no Core patch or false contextWindow is permitted.
- Advertised reasoning labels that the native SDK cannot express must show `REASONING_EFFORTS_UNSUPPORTED` rather than being silently hidden or guessed. Such a warning need not disable ordinary model requests.
- The Core-facing adapter integration uses the public `streamSimple` path. Its advanced protocol-specific `stream` entry must reject explicitly rather than accepting incompatible client objects from another SDK version. The event-stream compatibility boundary must verify the full public surface at compile time and preserve the original stream object.
- Cached catalog entries do not authorize requests independently. A change in the current grant's model-permission list invalidates old proofs even when the token and account identity are unchanged; a new server-enabled model absent from the earlier grant list remains discoverable without rewriting the grant.
- A plugin-owned credential invalidation or disposal preserves its specific `ABORTED` diagnostic through the native stream boundary. Only the plugin's own abort reason identity authorizes that diagnostic; upstream text never does. This does not repair HTTP 408 request-body timeouts or transport termination, change retries/timeouts, or turn incomplete Responses output into success. SDK error events can contain initialized zero usage without a received measurement; the public usage object lacks a presence flag, so the plugin does not discard zeros or rewrite native context metering.

## Delivery and local acceptance

- Open the plugin PR with tests, evidence limits, migrations and rollback. Merge only after required checks and review are satisfied; the user has explicitly included merge in this task's acceptance scope.
- Publish the aligned version through the protected Release workflow and verify the release/tag/commit/assets/checksum.
- Upgrade the user's actual local profile to that verified plugin artifact; do not infer the profile from a README example. Verify installed bytes and loaded runtime separately.
- The user has requested local upgrade. Explain any session-interrupting restart before doing it and obtain acknowledgement of that interruption. Do not install a modified Core as part of the upgrade.
- Report remaining limitations honestly, including unavailable provider metadata, unsupported protocols, optional summaries and any unperformed live checks.

## Metadata references

- [Microsoft Copilot API types](https://github.com/microsoft/vscode/blob/main/src/typings/copilot-api.d.ts)
- [Endpoint-driven Copilot discovery implementation reference](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/plugin/github-copilot/models.ts)
- [pi v0.85.1 release](https://github.com/earendil-works/pi/releases/tag/v0.85.1)
- [pi v0.87.1 release](https://github.com/earendil-works/pi/releases/tag/v0.87.1)

These references guide parsing and tests; they are not a guarantee that the upstream discovery schema will never change. Schema drift must be surfaced rather than silently guessed.

## Authentication, replay and request diagnostics

These failures have different owners; do not repair every rejection by signing out.

| Diagnostic | Boundary and safe action |
|---|---|
| `COPILOT_AUTHORIZATION_BEGIN_FAILED` | Sign-in did not complete; interaction milestones are not a credential commit or root-cause proof |
| `COPILOT_ROUTE_REPAIR_FAILED` | Authentication is retained; review legacy configuration and use explicit repair |
| Native AUTH / HTTP 401 | Exact managed proof may be retired; a later explicit request/discovery can renew natively, not replay the failed message |
| `COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH` | Exact uncoded item-scope rejection is request-local INVALID_REQUEST, without invalidating shared proof/other requests |
| `COPILOT_RESPONSES_REPLAY_UNSUPPORTED` | Incomplete/reference-only historical payload lacks safe reconstruction evidence |
| `COPILOT_REQUEST_BODY_TIMEOUT` | Strict verified request-body 408; composition/timing is not proof of overflow or network cause |

HTTP auth recovery is bounded by account cooldown, including forced discovery.
An old late response cannot invalidate a newer sign-in. HTTP 403, network errors
and strings mentioning 401 are not auth evidence; malformed/ambiguous/oversized
bodies retain native handling. HTTP tests do not prove WebSocket recovery.

### Responses replay compatibility

The public SDK payload hook normalizes only direct IDs on complete assistant
messages, function calls and encrypted reasoning items. A narrowly recognized
empty completed reasoning shell can be omitted from outgoing requests only with
empty summary/content, no encrypted content and no unknown fields. Durable
history, public summaries, opaque bytes, nested IDs, phase and `call_id` pairing
stay unchanged.

The source-checkout follow-up for #279 adds bounded structure evidence to an
exact verified scope rejection: total items, direct ID fields, reference items,
encrypted reasoning items, unrecognized items, `previous_response_id`/`store`
state and presence of the two native session/request headers. It observes the
final HTTP dispatch, not the earlier SDK payload before caller replacement.
Only fixed labels and counts enter the separate `dispatchEvidence` diagnostic
and Host warning; the main error stays concise and points to explicit recovery
or a new conversation. No IDs, header values, message text, arguments, results
or opaque bytes are retained. The shared
16 MiB/depth/work diagnostic limits apply; unavailable evidence never becomes
zero counts. Historical errors are not rewritten; absence of captured evidence
is not zero counts.
Structure counts alone do not repair cross-turn scope rejection: zero direct
IDs does not prove encrypted replay is portable.

Switching from account A to B does not make old account/connection-bound
encrypted reasoning portable. An exact scope rejection is not proof that
sign-in failed or that a particular encrypted item was rejected. Recovery
is an explicitly authorized, lossy continuation, not a portability repair.
Starting a new conversation avoids replaying the old history.

### Explicit session replay recovery

After an exact verified managed Responses scope rejection, **Replay recovery**
above that session's composer automatically offers the failed request's old
encrypted items on opening the eligible session, when its native `running`
snapshot settles, or when its `lastAgentError` changes while idle. These public
Session snapshot changes trigger read-only Host evidence reads, not model calls,
history reads, new durable events or polling. Normal sessions show no notice.
Dismissal is local to the mounted model/session and evidence revision; a new
failure can reappear. Read errors remain distinct from missing evidence.

Context evidence and recovery use the public full-width
`conversation.input.dock` with shared native secondary typography for body
text and controls. They stack above the composer rather than squeezing into
its non-wrapping statistics row. Native meters, statistics and parent DOM stay
unchanged; authorization itself still sends no message.

The normal Client offers one persistent Session policy. When off, the notice
explains the loss and offers **Enable visible-history continuation** or Cancel.
Enabling writes the same revision-checked Session policy used by account controls;
it persists across accounts/restarts until disabled, without an hourly consent.
When already on, show status and diagnostic guidance, not another authorization.
Use native Retry separately. Missing or failed policy reads have an explicit
diagnostic and Retry read, never a guessed off state or legacy authorization
fallback. No authorization duration radios or next-turn-only actions are shown.
Controls are disabled during a native turn.

The following temporary recovery mechanism and strict Remotes remain for
compatibility, not new normal UI authorization. Their one-hour evidence/proof
lifetime is not the lifetime of the persistent Session policy:

This is lossy recovery, not a supplier-scope repair. Only complete normalized
encrypted reasoning items whose entire serialized fingerprints match that
failed request are omitted from later outgoing requests in the same session
and model. Their hidden state **and their item summaries** are no longer sent;
displayed messages, tool calls/results and stored history are not modified.
New or changed reasoning items remain native-owned. Another scope failure
requires fresh confirmation rather than broadening enabled omission silently.

Evidence is bounded to 64 sessions, 512 distinct items per session, and one
hour in the current Host. Only hashes, a model label and confirmation metadata
are retained, never opaque payloads. The Client receives count/model/state,
an opaque revision, optional duration and evidence expiry only. The original
`get`/`setEnabled` descriptors retain their identities; `setEnabled(true)` still
means bounded session consent, and additive `authorize` selects a duration.
A one-shot expiry read updates the mounted notice, not a polling timer.
Token/account/metadata proof discontinuity, expiry,
session disposal or Host restart revokes evidence; an old error on disk cannot
create a candidate. Re-read status after these changes. Disabling affects
future requests and does not undo answers already generated.

Admission requires the initiating native Agent request signal and exact
session; unbound requests, compaction, titles, classifier requests, other
models and other sessions cannot borrow consent. Active-turn writes are
rejected. Public native Client/Host gateways enforce explicit Agent lookup;
no ambient Client session projection is added. No Core changes, credentials
reset, history rewrite, general wire adapter or automatic business retry is
introduced. This is not a remedy for HTTP 408, quota or context limits.

Two explicitly authorized real-history diagnostic calls reproduced HTTP 401
with 12 old encrypted items and returned HTTP 200 after omitting exactly those
items in a disposable request copy, preserving all 80 tool pairs. This
implicates the old item set, not any specific item, token rotation or backend
expiry rule. Sequential calls cannot freeze hidden supplier state. Synthetic
request-chain and native gateway tests qualify the opt-in mechanism; they do
not establish that every rejected history is recoverable or that an installed
runtime has enabled it.

After actual HTTP 408, a newly prepared attempt in the same native step can
reuse exact normalized payload only when transcript/every other field agree,
with matching references and no conflicts. Evidence is bound to Session/model/
account proof and original signal, expires in 60 seconds, is limited to 2 MiB
and clears on next step/turn, concurrency, cancellation or account discontinuity.
This creates no retry or cold-history reconstruction. Canonical/other routes,
protocols and native retry policy stay unchanged. Synthetic adapter tests are
not acceptance proof for an old conversation. Never discard opaque reasoning,
rewrite history, replay business work or reset credentials automatically.

For TLS/quota, see [trust boundaries](./copilot-usage.md#account-data-boundary).
For HTTP 408 and oversized summaries, see
[budget and recovery limits](./copilot-compaction.md#existing-oversized-history-and-recovery-limits).
