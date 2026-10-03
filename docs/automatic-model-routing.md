# GitHub Copilot Auto model routing

**Tracking:** [#174](https://github.com/cloga/dsh-github-copilot/issues/174), [#192](https://github.com/cloga/dsh-github-copilot/issues/192), [#199](https://github.com/cloga/dsh-github-copilot/issues/199), [#258](https://github.com/cloga/dsh-github-copilot/issues/258)

**Target:** official DSH and Windows Desktop `0.2.0-rc.2`

**Boundary:** plugin-only; no Core source, artifact, registry, prototype, or history patch

**Current behavior:** published alpha.88. Start with [task assessment and
captured reasons](./auto-task-routing.md), [parent following](./parent-model-follow.md)
or [model exclusions](#model-exclusions-and-richer-picker-boundary). The dated
investigations below preserve earlier evidence and limitations; they do not
supersede the current one-switch following and exclusion behavior.

**Interactive mockup:** [`output/auto-model-mockup/index.html`](../output/auto-model-mockup/index.html)

## User contract

The managed `github-copilot-preview` provider contributes **Auto · Balance** (the existing `auto` ID), **Auto · Efficiency**, and **Auto · Intelligence** to the ordinary flat model picker. They never appear under another provider and never route across providers or accounts. Explicitly selecting another virtual preference preserves Auto intent; only a real model selection exits Auto.

Selecting Auto uses normal Core selection behavior, including saving it as the future default selection. For every Core turn, the plugin resolves Auto to one real model from the authenticated account catalog:

- one decision is made for the turn;
- every model request, tool continuation, request-error retry, and compaction retry in that turn uses the same real model;
- a later user turn or Goal continuation is a new turn and may select a different model;
- an explicit real model selection always wins;
- the actual model remains the provider transport, usage, replay, and billing identity.

A Goal does not become one indefinitely frozen Auto decision. Each automatic continuation that Core opens as a new turn is classified independently. Tool steps inside that turn do not trigger another decision.

## Routing policy and input fit

Image capability requirements cover all entered message content, including historical
user and tool images, not only the latest user text. Actual projected MIME admission
uses explicit account format evidence after native conversion; filenames and durable
MIME are not wire-format proof. See [image compatibility and limits](./image-input-compatibility.md).

The account `/models` catalog is authoritative for entitlement and hard capabilities: protocol, context and output limits, image input, tool support, reasoning efforts, and server policy. Unknown or incomplete capability metadata fails closed.

The catalog supplies `model_picker_category` (`powerful`, `versatile`, `lightweight`), but not trustworthy measured quality, latency, price, or global-health rankings. Missing, invalid and new category values remain unclassified with diagnostics. The routing policy does **not** infer category from a marketing name, model-ID prefix, reasoning effort, context capacity or token price. It does not claim to reproduce GitHub's private Auto algorithm.

### Hard input fit check before preference

Before applying soft preferences, routing checks whether each candidate can accommodate the estimated input tokens of the current turn:

1. **Input estimate:** `estimateTurnInputTokens` prices every entered Core message through the public native `tokenMeter.estimateMessage()`. Core reasoning, tool calls and tool results must not be passed to pi-ai's differently shaped message estimator or silently omitted on exceptions. The Host also retains `tokenMeter.measure(session).totalTokens` as a conservative floor for the current surface, native usage accounting and known tool envelope. Missing native measurement fails Auto with `COPILOT_AUTO_TOKEN_METER_UNAVAILABLE`; invalid numeric estimates fail with `COPILOT_AUTO_TOKEN_ESTIMATE_INVALID`. Explicit real-model selection does not require this Auto seam.
2. **Hard candidate budget:** For each candidate model, `calculateRequestBudget` calculates `hardInputLimit` given the model context window, output reservation, and safety allowance.
3. **Headroom filtering:** Candidates with insufficient headroom (`estimatedInputTokens > hardInputLimit`) are filtered out. If one or more fitting candidates exist, soft preference selects among the `fitting` subset.
4. **No-fit and compaction recovery:** If no candidate can fit the current messages:
   - Auto selects the candidate with the **largest input capacity** to give Core compaction maximum headroom.
   - Its in-memory routing decision includes a structured diagnostic (not a new durable event):
     - `fixed-content-cannot-fit`: the latest user turn alone exceeds maximum capacity and cannot be compacted away.
     - `compaction-unavailable`: compaction is disabled or has zero retries configured.
     - `attempted-but-still-oversized`: a compaction summary already exists in history and the turn remains oversized.
     - `compaction-eligible`: prior history is compressible and downstream dispatch will trigger compaction pressure.
5. **Final framing limitation:** The fresh entered-message estimate and current native envelope floor are not the final candidate-specific serialized request. Later framing, changed tools and native attachment projection can still exceed a candidate's budget. The native provider guard (`inspectRequest`) remains authoritative and truthfully rejects such a request with `COPILOT_CONTEXT_BUDGET_EXCEEDED` without bypassing safety boundaries.

### Task-aware supplier category preferences

All three preferences use the *same* hard-eligible account pool. The default local
assessment recognizes isolated greetings, explicit difficult reasoning or
investigation, bounded explicit continuations of those difficult tasks, and
isolated fenced mechanical transformations. Other tasks remain uncertain rather
than guessing from length; insufficient local evidence does not mean the
conversation lacks context.
Default-enabled `github-copilot.autoSemanticAssessment` makes one
bounded auxiliary native-adapter call to a concrete, non-excluded supplier
Lightweight model only for locally unknown demand. It prioritizes the current
and preceding user requests without removing omitted-context safeguards. It
adds latency and supplier charges not included in native
chat Usage. Set it to `false` to opt out; existing explicit false is preserved.
This user-authorized default rollout does not claim labeled-corpus calibration.
Alpha.88 bounds the output to 128 tokens and retains the 8-second end-to-end
deadline. Reasoning is requested off only with matching supplier and prepared-model
support. Timeout leaves demand unknown and uses preference/category fallback,
without another classifier call. Captured auxiliary milestones are not network
dispatch timing, billing or a measured speedup.

| Task demand | Efficiency | Balance (`auto`) | Intelligence |
| --- | --- | --- | --- |
| Proven simple | Lightweight | Lightweight | Lightweight |
| Routine | Lightweight | Versatile | Powerful |
| Complex | Powerful | Powerful | Powerful |
| Unknown | Versatile | Versatile | Powerful |

If the target category has no fitting model, follow the documented category
fallback order, using unclassified models only last. Keep the previous managed
model if it remains in the first available category and fits this turn.
Otherwise use stable equal-weight Session/turn allocation within that category;
ID ordering breaks ties, not quality rankings. Capacity and reasoning-effort
bands no longer determine task quality. All steps/retries retain the decision.

These are declared policies, not measured quality, speed or cost guarantees.
Captured footer reasons show task evidence, selected/target category, fallback,
continuity or equal tie-breaking, and no-fit recovery. Legacy records without
details say the reasons were not retained; they never reconstruct history from
today's settings. See [requirements, assessment limits and rollout](./auto-task-routing.md).

The exact virtual preference stays in the Session's pending selection across turns, while each real request header and transport record the chosen account model. Switching to a real model ends automatic routing for subsequent turns. New turns no longer write a separate decision event; compatible historical events without a preference field remain Balance for display.

## Images

Image input is part of the MVP.

The virtual Auto picker entry advertises image input only when the current authenticated catalog contains at least one eligible image-capable model. At routing time, an image turn filters out every text-only candidate. If catalog changes leave no eligible image model, the turn fails with a named Auto routing error instead of sending the image to an unverified model.

This preserves two separate checks:

1. Core's normal picker/admission path sees truthful aggregate Auto modalities.
2. The resolved real model is independently verified against the current account snapshot before transport.

## Context pressure and automatic compaction

Auto may choose a model with a smaller context window than the previous turn. The plugin must not trim history, create a competing compaction service, or silently switch models during recovery.

The resolved real model enters the existing managed-route request-budget path. If the estimated committed request exceeds that model's input budget, [`src/compaction-pressure.ts`](../src/compaction-pressure.ts) emits the normal `CONTEXT_WINDOW_EXCEEDED` signal before transport. Core's stock transactional compaction then:

1. summarizes and replaces eligible history;
2. rebuilds the request;
3. retries the same turn with the same resolved real model;
4. keeps the ordinary bounded overflow retry policy.

The guarantee is limited to history whose summary request itself fits. Correcting the Auto estimate does not recover a session when every eligible model is too small for the existing summary input. A fixed prompt, current attachment, or indivisible content block that cannot fit after compaction remains an explicit error. See [Copilot compaction](./copilot-compaction.md).

## Search ownership

Chat Auto does not own or alter the independent `github-copilot-hosted` search provider.

- A nonempty explicit `searchModel` remains authoritative.
- Automatic hosted-search candidate selection continues to use its own bounded account-owned Responses policy and capability proof.
- Routed search that follows the initiating Chat request sees the durable real request header, not the virtual Auto ID.
- The final query is still sent once; Chat Auto introduces no search replay or fallback.

## Attribution and explanation

**Host binding follow-up (alpha.79, #254):** alpha.76 fixed Client argument
projection, but the Host still provided selection reads as an ordinary
`ctx.provide(..., { get })` object. That is not a Typert Remote service.
The native strict Host gateway rejects it with `gateway/binding-invalid`
before reading the store; source-mode discovery cannot expose the endpoint
without a Remote binding and method marker. A fresh master reply can therefore
show **Selection unavailable** even after the Client fix.

`TurnSelectionController` now extends the published `TypertRemoteService` and
marks `get` with `@Remote`, following the other plugin Host controllers. It wraps
the same bounded `TurnSelectionStore`, with unchanged explicit Session/turn
arguments, native Agent lookup/access checks, missing-evidence semantics and
disposal. It does not append history, grant child access, infer a selection or
alter Auto routing.

Regression coverage crosses the actual Client gateway, in-process native Host
connection and actual Host gateway in both source-discovery and strict modes.
It reproduces the old registration failure and checks Auto, Manual, missing
records, missing/denied identities, removal and service unload. An isolated
process also exercised the unchanged rc.2 public modules bundled in the installed
Desktop; this is contract evidence, not a query of the running Host or live
model transport. The previous Client-only mock transport was insufficient
evidence for Host reachability.

**Fresh master/lead selection reads (alpha.76, #249):** the footer explicitly
calls `get(viewedSessionId, turn)`. Its old Remote descriptor also declared an
automatic `agent` scope projection. The unchanged rc.2 Client gateway prefers
that projection when a Client context has an agent identity, removes the ID
parameter from its expected arguments, and rejects this two-argument call with
`expected 1 argument(s), got 2` before sending RPC. Existing root-context mocks
did not exercise this behavior. This is a reproducible new-reply display failure,
not evidence of missing historical decisions or an Auto routing failure.

The descriptor now exposes only the direct two-argument Client call. Its native
Host `agent` lookup, strict Session ID/turn/result codecs and method identity
are unchanged. The viewed Session is never replaced by an ambient current
Session. Native gateway regression runs the old descriptor to reproduce the
rejection, then checks the fixed descriptor with both bound and unbound contexts.
Host access checks are not bypassed: native child lookup restrictions remain a
separate limitation, not the explanation for the reported master/lead case.

Pending reads show **Loading selection…**; failed or invalid reads show
**Selection unavailable** and an explicit **Retry**. Retry reads the same
Session/turn, does not rerun inference, and never exposes a raw error response.
Only a successful read with no retained decision shows **Selection unknown**.
Compatible historical attribution can still supply an independently known Auto
decision. This change does not persist decisions or recover evicted evidence.

**Completed-turn fallback (alpha.71, #238):** a new Desktop Session was observed without the Auto label despite alpha.70 reporting all three components running. That status does not attest every optional Client dependency fiber. The reproducible defect is that the actions entry waited for `uiConversation` registration, and then required its optional provenance projection even when the Host retained the exact turn's selection. The original live Client trigger has not been established from console evidence.

The actions entry now waits only for the selection Remote namespace and public slots. Historical attribution/provenance definitions register independently. A native `turn-tail` matching the displayed closing message, turn and valid completion sequence is independent completion evidence: a retained Auto/Manual selection can render without the optional projection. Native `tokenUsage.routes` can establish Copilot ownership for **Selection unknown** when projection data is absent. Missing projection evidence remains visibly incomplete; it never becomes guessed Manual, a guessed preference, or a reconstructed historical selection. Invalid/mismatched completion stays hidden. Projection failure cannot unregister the independent actions entry.

Regression coverage includes absent/failed projections, exact Session/turn binding, stale responses, incomplete disclosure and pending Client dependencies. The existing exact-source UI fixture exercises native assistant/turn-tail assembly, cold replacement and incremental append, and the real session-scoped slot renderer without plugin projections. These are synthetic regressions, not proof of a newly loaded Desktop Client or live inference. No Core, history, settings, credentials, routing policy or native Usage changes are required.

**Desktop collection compatibility (alpha.63, #222):** the assistant-actions selector reads the public `snapshot.nodes.values()` iterable. Official ChatNodeStore returns an array; a JavaScript Map returns an iterator. Neither requires class identity checks or private-store access. Unsupported collections emit `COPILOT_TURN_SELECTION_CHAT_NODES_UNAVAILABLE` once and suppress the footer without reading another turn. This fixes the missing label/disclosure without changing selection policy or restoring lost Host-lifetime evidence.

**Compatibility fix (alpha.54):** new turns omit plugin-specific Auto decision events. Official `0.2.0-rc.2` cannot set an `ignorable` envelope through public `Session.append()`, and its reader rejects unknown required plugin events. The plugin therefore stops writing `github-copilot/auto-model-decision` rather than patching Core, mutating event objects, or borrowing an unrelated event type. Core's actual model/usage provenance and Auto routing remain unchanged. Restore new decision recording only when a supported public informational-event or equivalent storage seam has proven cold-read compatibility.

Completed Copilot replies show **Auto (preference)** with an information button, **Manual** with captured explicit fixed-selection evidence, or **Selection unknown** when that evidence is absent. The public `conversation.chat.assistant-actions` slot places the plugin's own flex item after native Usage/time using `order: 1`. There is no separate Model details entry or repeated model name. The native parent is a fixed-height, non-wrapping row: the plugin can shrink/wrap its own item but cannot promise whole-row wrapping, and does not modify native ancestors. A turn without a closing message has no assistant-actions anchor.

New Auto decisions and matching explicit fixed selections are captured at dispatch in a bounded in-memory store (64 Agents, 128 turns per Agent, first decision per turn). `githubCopilotTurnSelection.get` uses Core's native agent scope and lookup, with its existing Session resolution and ownership checks, rather than a plugin-owned arbitrary-session metadata endpoint. The lookup can use normal Core resume semantics; it is not a new access-control system. The Client reads once for the exact displayed Session/turn, cancels stale responses and never polls. Agent disposal, plugin disposal, eviction or Host restart removes evidence; no new Session event is emitted. Compatible historical Auto events can supply a recorded preference and reason; omitted historical preference is not guessed.

The expandable explanation reports captured task assessment, supplier category preference, eligible/fitting counts, fallback/continuity and optional auxiliary milestones. It is selection evidence, **not proof of execution**. Absence of Auto evidence never implies Manual, and today's picker/request header never fills a historical gap. Native Usage remains the only model/usage display; the explanation does not replace its all-or-nothing accounting. Since alpha.87, context diagnostics no longer filter shared terminal-zero usage; genuinely missing samples/lifecycle can still leave a turn incomplete. See [cancelled and failed samples](./copilot-usage.md#cancelled-and-failed-terminal-samples-270). A metadata-only projection flags incomplete attempts/history without duplicating or allocating tokens. The disclosure never reads message content, replay data or credentials.

### Recovering affected histories

Upgrading prevents new incompatible events but does **not** rewrite existing logs. Repeated restarts cannot repair a stored missing marker.

From a source checkout of this version, with Node 24 LTS and the pinned dependencies installed using `pnpm install --frozen-lockfile`, run:

```powershell
# Read-only validation; prints counts, affected sequence numbers and hashes, never conversation content.
node scripts\repair-auto-model-history.mjs 'C:\absolute\path\session.v4.jsonl.zstd'

# Optional: create a NEW private recovery directory outside the live Session directory.
node scripts\repair-auto-model-history.mjs 'C:\absolute\path\session.v4.jsonl.zstd' --write-copy 'C:\private\new-recovery-directory'
```

This is an explicit offline maintenance utility, not an installed plugin hook. It reads all concatenated zstd frames, uses the exact published official `0.2.0-rc.2` format catalog for strict whole-history validation, and adds only `ignorable: true` to recognized Auto decision envelopes. It preserves type, sequence, time, data and all other rows. Unknown required events, invalid decisions, torn tails, invalid relationships, non-v4 input and compressed/decoded inputs over 128 MiB fail closed. It never repairs or drops other errors.

Copy mode creates `original.session.v4.jsonl.zstd` (byte-exact backup), `session.v4.jsonl.zstd` (validated repaired copy), and `repair.json` (SHA-256 receipt). It refuses existing destinations and never writes the source. Keep the directory private: both logs contain conversation history. A check/copy can become stale if an active writer appends later.

The compressed output keeps the header in its own first zstd frame, as required by Desktop's persistence discovery and reader. The original alpha.54 utility incorrectly combined the header and events into one frame: those copies passed logical event validation but disappeared from Desktop discovery. Use the corrected utility on such a copy; `reframedHeader: true` reports this physical-layout repair even when `changedSeqs` is empty. No logical rows change during reframing, and the current source is backed up separately. A zero `changedSeqs` count alone from the original utility was not proof of Desktop readability.

**Applying a copy requires separate operator approval:** first stop all writers for that Session, verify the fixed plugin will load before resuming, and recheck the live log against `originalSha256`. If it changed, regenerate and validate a fresh copy. Preserve the backup, replace only the exact affected log, verify its hash against `repairedSha256`, then use the normal official history reader to reopen it. Do not replay business requests as a test. If recovery fails, stop writers before restoring the exact original backup. Neither this utility nor the plugin installs itself, replaces a live file, restarts Desktop, clears credentials, or automatically migrates histories.

## Subagents and Agent Teams

General native subagent Auto inheritance is **not** in the base MVP.

In official DSH 0.2.0-rc.2, `TeamRoster.spawn` calls `ctx.subagents.startContinuable` without `request.agentOptions`. Core initializes the child from the parent's latest recorded request route, falling back to the parent's creation options before it has made a request, and records the resulting child options in its descriptor. This is creation-time inheritance, not a live link to the parent's selection. A recorded concrete route alone does not establish whether it came from an inherited selection or an explicit child override, and a resolved route does not prove the parent had no pending Auto intent. The plugin must not relabel a child route as Auto or write fabricated selection history.

With `followParentModel` off and no legacy `parentModelFollow` enrollment, the plugin preserves native child routing behavior:

- a child with an explicit model override uses that model;
- a new child or Team mate without an override starts with Core's parent-route snapshot and fallback behavior;
- later parent changes do not retarget an existing child through the native continuation path;
- the child UI shows the real model truthfully;
- no plugin code claims independent child Auto classification.

## Requested parent-to-child selection inheritance

The desired behavior is for native subagents and Team mates to follow the master's **effective selection on each new child turn**, not only snapshot the route that was effective when the child was created:

- An explicit child model override takes precedence over inheritance.
- At child creation, an enrolled child starts from the parent's effective selection. On each later child turn, the follow-policy resolver reads its direct parent's current effective selection unless the child has an explicit override.
- If the parent is fixed to a model, the next child turn follows that provider/model. If the parent is Auto, the child retains Auto intent and independently resolves a model for its own turn; it must not be pinned to the parent's concrete model for that turn.
- A route is stable within a turn: changing the parent while a child turn is running does not hot-swap an in-flight request. The new parent selection applies when the child begins its next turn.
- The implementation must retain provenance that distinguishes inherited Auto, inherited fixed selection, and an explicit child override across child creation, message delivery, and cold resume. A concrete model ID alone cannot prove Auto intent.

### Implementation sketch and boundary

This is a requested product direction, not current behavior. A native implementation would carry an explicit inheritance mode and parent/override provenance, then resolve the parent's current effective selection at the start of each new child turn. For Auto, the child must invoke its own per-turn Auto resolution against its own messages and capabilities. Explicit child selection remains authoritative. The resolver must use the live parent's selected/requested model state, not the global default, and must fail visibly when parent evidence is missing rather than guess from a stale concrete child route. The open [Core PR #95](https://github.com/cloga/deepseek-harness/pull/95) proposes creation-time route rules for new children; its design preserves existing children on later messages and does not establish per-turn parent-following or inherited Auto intent.

The plugin uses public request-selection middleware for supported native `spawn` children. The profile-wide switch explicitly authorizes overriding creation-time snapshots without inferring their original intent; legacy per-child bindings remain compatible. This is opt-in policy, not a change to native defaults. Actual request routes remain authoritative; native Team labels are not rewritten.

### October 2 investigation: routing is possible; automatic enrollment is ambiguous

Tracking: [#229](https://github.com/cloga/dsh-github-copilot/issues/229).
The target remains unchanged official `0.2.0-rc.2`, commit
`639ed015397290b3745d163aafe02ffee4aa3f84`, not the proposed Core branch.

| Exact source | Finding |
| --- | --- |
| [child-agent.ts](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/subagent/subagent/src/child-agent.ts) | `parentAgentOptionsForDelegation` reads the latest request header before creation options. `resolveChildAgentOptions` merges overrides and discards whether an equal route was explicit. |
| [continuation.ts](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/subagent/subagent/src/continuation.ts) | Creation snapshots resolved options; cold resume reconstructs them from the descriptor. No next-turn parent-model recapture is performed here. |
| [descriptor.ts](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/subagent/subagent/src/descriptor.ts) | Descriptor v3 stores resolved route/effort, not follow/override provenance, and rejects unknown fields. |
| [model-selection.ts](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/core/agent/src/model-selection.ts) | Public `installModelSelection` couples scoped prompt assembly and request routing, clears inherited effort, and supports disposal. Its snapshot boundary is a step, so a follow policy must additionally freeze selection for a whole child turn. |
| [subagent index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/subagent/subagent/src/index.ts) and [lifecycle.ts](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/subagent/subagent/src/lifecycle.ts) | Public start/end notifications describe published runs; they are not a before-create interceptor exposing original override intent. The activation observer is package-private. |

An isolated Node 24 experiment executed the unchanged child-option resolver,
descriptor functions, and public selection middleware from that commit. Each
downloaded file's Git blob SHA was checked against the GitHub contents response
before execution. TypeScript was stripped with Node's compiler; depth, JSON
snapshot, message constructors, and the event context were synthetic dependencies.
Six assertions passed:

1. Omitted overrides and an explicit provider/model equal to the parent produce identical resolved options and identical durable descriptors.
2. Changing the parent's recorded route changes a newly resolved child, not the previously captured descriptor.
3. A concrete parent request header takes precedence over Auto creation options.
4. Before the first parent request, Auto survives the creation-options fallback.
5. Adding an invented `followParent` descriptor field is rejected by the official reader.
6. Public model-selection middleware applies a fixed route, forwards virtual Auto on subsequent assembly, clears inherited effort, and removes its listeners on disposal.

These are exact-function experiments, not full Core activation, real Team turns,
cold-resume integration, or model transport evidence. In particular, forwarding
an Auto ID does not by itself prove child-specific Auto resolution.

The first result is a counterexample to automatic override detection: two
different user intentions yield the same observable child state. Comparing
parent/child model IDs, inspecting only `Agent.options`, or treating a missing
child picker event as inheritance cannot implement the stated precedence for
every existing child. Request middleware does not recover the lost information.

### One-switch policy and legacy per-child bindings

The ordinary UI is now one profile-wide **Follow parent model** switch in the
plugin configuration page. See [requirements, design and mockup](parent-model-follow.md).
It defaults to Off and does not ask users to manage child IDs. Explicitly
enabling this broad policy authorizes replacing creation-time snapshots;
child-owned manual selection events still win. The per-child binding mechanism
below remains for alpha.66 compatibility, not as the ordinary user workflow.

**Legacy opt-in bindings; preserved independently of the broad switch.**
Do not silently enroll all existing children or treat a new setting as proof of
their original creation intent. `github-copilot.parentModelFollow` defaults to
an empty array. The standard plugin configuration accepts explicit bindings:

```json
{
  "parentModelFollow": [
    { "childSessionId": "<native-child-session-id>", "parentSessionId": "<direct-parent-session-id>" }
  ]
}
```

These are native DSH Session IDs, not role names, model IDs, or Copilot App
session handles. A binding authorizes replacement of the child's captured
creation route. No binding is added by installation or discovery. Existing
child-owned `model/selection` events take precedence, even for a same-model
selection; enrollment does not clear them. Remove the binding to return to
native routing at the next turn. Settings changes during an already captured
turn do not interrupt or change its route.

- A user explicitly enrolls a child Session through the native plugin configuration and its path-level settings writes, or leaves it under native selection. Bindings live only in this plugin's configuration. Do not add descriptor fields or new Session history events.
- A pure Host-only projection folds existing child-owned selection events, turn starts, and native descriptor evidence, excluding inherited seed events. A later explicit child selection suspends following from its next turn, including a same-model reselection. Once present, a child-owned selection is not cleared by toggling enrollment.
- Read the direct parent's pending selected intent first, then its proven effective route. Preserve the exact Auto preference. Do not borrow the global default, another Session, or a stale request header when a newer pending choice exists.
- Freeze one selection before the child's first prompt assembly in a new turn. Reuse it for every subsequent step/retry/compaction attempt in that turn. Integrate it with the existing per-Agent Auto resolver so Auto evaluates the child's admitted messages and capacity requirements, not the parent's chosen model.
- Reuse normal managed adapter admission for fixed-model availability and exclusions, and the existing validated candidate pool for Auto. Clear inherited reasoning effort while retaining output caps. Missing parent/selection evidence yields a named `COPILOT_PARENT_MODEL_*` diagnostic, never a guessed model or silent fallback.
- Restore policy from plugin-owned settings on cold activation and inspect only public projections. Do not call public `session.selectModel` for propagation: it also writes the future global default. Do not convert historical provenance or alter native permissions.
- Keep scope to verified native `spawn` children and managed Copilot parent routes. Dedicated historical role policies, fork-provider descriptors and externally managed providers are rejected when enrolled. Nested enrollment follows verified direct-parent links until an explicit selection or non-following parent supplies the intent; cycles and missing parents fail visibly.
- Verify native Team model labels separately: a roster label may describe a creation snapshot rather than the next request. Do not claim accurate live UI simply because request routing changes.

Release gates combine policy, Host/configuration and unchanged-Core regressions:
fixed A to B, fixed to Auto and Auto to fixed, every Auto preference, independent
sibling inputs, turn freezing, explicit child overrides, fork seed boundaries,
strict history reading/refolding, unavailable parents, normal model exclusions,
live binding changes and disposal. The native AgentLoop fixture reconstructs a
child from its own strict-reader-validated history and verifies the next turn;
it does not exercise disk-backed resume or the native Team orchestrator.
The native creation path cannot recover original equal-route override intent.
Legacy bindings authorize individual children; the new switch authorizes this
tradeoff once for the profile. Neither mechanism fabricates provenance or clears
child-owned selection events.

Local full validation is blocked: `pnpm exec vitest --version` triggered pnpm's
dependency reconciliation, which failed with HTTP 404 for
`https://packagefeedproxy.microsoft.io/npm/@deepseek-ai/dsh-llm/-/dsh-llm-0.2.0-rc.2.tgz`.
No registry restriction was bypassed. The isolated experiment above does not
replace the complete repository and exact-Core compatibility gates.

Implemented files are `src/parent-model-follow.ts`, `src/auto-model-host.ts`,
`src/config.ts` and `src/preview-route.ts`. Nine dependency-free policy tests
passed with `node --test tests/scripts/parent-model-follow.test.mjs`, and the
policy module passed a focused TypeScript check. An actual-plugin-source VM
experiment passed fixed/Auto turn freezing, config removal, explicit child
override, reinstallation/refolding and no-history-write assertions with synthetic
Context/LLM/token-estimator dependencies. Focused Vitest Host/config tests and
the real Session projection/AgentLoop fixtures run in the required Windows/Linux
CI matrix; the incomplete local dependency installation cannot run those gates.
The AgentLoop fixture uses the actual TokenMeter and a synthetic public adapter,
not a live model endpoint. Native Team end-to-end behavior, disk persistence,
Desktop activation and transport remain separate, unclaimed evidence layers.

## Public API implementation

The plugin uses only published public seams:

- `PreviewAdapter.listModels()` publishes three virtual Auto picker entries alongside real account models.
- `PreviewAdapter.resolveModel()` returns aggregate Auto modalities for picker admission.
- `agent/pre-step` captures the admitted current-turn messages.
- a prepended `agent/request` listener awaits Core's model-selection middleware, recognizes only `github-copilot-preview/auto`, resolves one real account descriptor, and returns the real model before `request/header` persistence.
- the adapter refuses unresolved Auto in `prepareCall()` and `stream()` so a missing middleware path fails loudly.
- a per-Agent, per-turn decision cache keeps all later steps and request-error retries on the same model.
- existing descriptor leases, credential proof, account continuity, request budgets, native pi-ai transport, replay, and cancellation remain unchanged.

The virtual Auto selection can remain pending while the real request header records the actual model. This is intentional: an unrelated real header must not consume the durable Auto preference. A later explicit picker selection replaces the pending Auto choice through Core's normal projection.

For an otherwise unselected Session that inherits Auto from the global default, the first virtual request persists a `model/selection` Auto intent before its real request header. Core's request-header fallback would otherwise make the next turn fixed. The plugin restores the pending Auto route during subsequent prompt assembly and request resolution without changing the real header, and yields immediately to a later explicit selection. It does not turn an existing Session with a real recorded route into Auto just because the global default changed.

## Acceptance criteria

The implementation is accepted only when unchanged official Core contract tests prove:

1. Auto appears only in the managed Copilot provider and explicit real/provider selections remain untouched.
2. Core's downstream model-selection result is visible to the prepended plugin listener, and the committed request header contains the resolved real model.
3. Auto intent remains durable while actual request provenance remains real.
4. one turn with multiple steps or request-error retries loads one routing decision.
5. a new user or Goal turn may make a new decision.
6. image admission and real candidate filtering agree, including the no-image-candidate failure.
7. choosing a smaller-context model can trigger the existing local pressure signal, Core compaction, and same-model retry without sending the oversized request.
8. hosted search remains independent and never receives the virtual Auto ID as a transport model.
9. no new unknown required attribution event is written; compatible historical attribution is retained, while missing decision events produce no guessed footer.
10. input fit check filters out candidates with insufficient hard input headroom before soft preference.
11. soft preferences distribute across upper/lower/center candidate bands without monopolizing one top model.
12. no Core file, dependency artifact, private registry, shared model catalog, or live history is modified.

Synthetic tests prove composition and contracts only. They do not prove a live account's model availability, provider quality, pricing, OAuth readiness, Desktop activation, or real transport success.

## Deferred work

- benchmark-backed quality/latency/cost ranking;
- GitHub health signals or GitHub's private Auto service;
- custom nested picker grouping (exact managed model exclusions are implemented);
- cross-provider routing;
- upstream native rules/settings UI and unsupported lineage following (the plugin's opt-in supported-child policy is implemented);
- model fallback after a provider failure;
- side-effect replay;
- automatic changes to existing Session selections, settings, or histories.

## Model exclusions and richer picker boundary

**Tracking:** [#192](https://github.com/cloga/dsh-github-copilot/issues/192). **Interactive proposal:** [`output/auto-model-mockup/tiers.html`](../output/auto-model-mockup/tiers.html). This is a local, synthetic UI exercise, not a claim of current Core picker behavior. The three virtual preferences, supplier-category routing, hard input-fit checks and plugin-owned model exclusions are implemented. The mockup's capacity quality scores and nested Core picker are not.

The attached Copilot example uses one Auto switch with a nested Efficiency / Balance / Intelligence menu. The supported DSH model picker is owned by Core and receives a flat provider directory from `PreviewAdapter.listModels()`; the plugin's Models provider-card and bundle-config slots cannot restructure that picker. The plugin advertises three rows under **GitHub Copilot**, with the existing `auto` ID as Balance for previously selected Sessions and defaults. A nested switch like the screenshot requires a separately reviewed public Core UI seam and is not a dependency of the plugin-only preferences.

Exclusions are a separate **hard filter**, not a fourth preference. All three preferences share account entitlement and turn-required verified capabilities, then remove the exact IDs stored in `github-copilot.excludedModelIds`. The mockup uses illustrative capacity scores and simulated responses, not live evaluation of model quality, cost, or latency.

The model-management surface is **Settings → Models → GitHub Copilot → Manage → Model preferences**, not a replacement of Core's picker. It offers local search, visible/excluded counts, **Exclude** and **Restore**, and retained restore rows for exact IDs temporarily absent from account metadata. Selected models can also be excluded: no Session/default scan or automatic selection write is required. The legacy `lockedModelIds` result remains empty.

Each row save uses `setModelExcluded(modelId, excluded)` and a narrow strict result after path-level native CAS persistence. It does not read credentials, discover models or enumerate Sessions. Unknown/missing preference settings make rows read-only with named diagnostics; Retry reads status, not discovery. The hidden volatile `excludedModelIds` Config leaf retains persisted exclusions through native Settings projection and restart.

The plugin does not mutate pi-ai's catalog, the account grant, Core provider settings or another provider's models. Its directory, Auto candidate sets/modalities, hosted-search route facts and new managed admission remove excluded IDs. An already-admitted turn retains its exact Session/turn/model and request-signal authorization for subsequent steps/retries; `turn/end` clears it. New turns, unbound/direct calls and stale picker rows fail with `COPILOT_PREVIEW_MODEL_EXCLUDED`. Independent account/proof/cancellation guards still apply. A fixed excluded selection is not silently changed; explicitly restore it or select another eligible model before the next turn. If exclusions leave no eligible candidate, Auto fails with `COPILOT_AUTO_NO_ELIGIBLE_MODEL`. Existing selections/history remain unmodified.

The native picker still owns provider groups and text search. It remains flat: the three virtual rows are listed first and excluded Copilot models are omitted from the plugin-owned directory. Custom section headers inside a provider, nested Auto menus, hiding other providers' models, and replacing Core search/layout are **not** available through the current additive slots. Focused regressions cover directory refresh, selected-model exclusion, stale direct requests, concurrent settings conflicts, Auto/image eligibility and zero-candidate failures against unchanged pinned Core. The prototype's invented model capacity order and response remain illustrative only.
