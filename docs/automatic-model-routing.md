# GitHub Copilot Auto model routing MVP

**Tracking:** [#174](https://github.com/cloga/dsh-github-copilot/issues/174), [#192](https://github.com/cloga/dsh-github-copilot/issues/192), [#199](https://github.com/cloga/dsh-github-copilot/issues/199)

**Target:** official DSH and Windows Desktop `0.2.0-rc.2`

**Boundary:** plugin-only; no Core source, artifact, registry, prototype, or history patch

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

The account `/models` catalog is authoritative for entitlement and hard capabilities: protocol, context and output limits, image input, tool support, reasoning efforts, and server policy. Unknown or incomplete capability metadata fails closed.

The catalog does not provide trustworthy quality, latency, price, or global-health rankings. The routing policy therefore does **not** infer model quality from a marketing name, model-ID prefix, provider order, or token price. It does not claim to reproduce GitHub's private Auto algorithm.

### Hard input fit check before preference

Before applying soft preferences, routing checks whether each candidate can accommodate the estimated input tokens of the current turn:

1. **Input estimate:** `estimateTurnInputTokens` measures current conversation messages using `@earendil-works/pi-ai/utils/estimate` (`estimateMessageTokens` and `estimateContextTokens`).
2. **Hard candidate budget:** For each candidate model, `calculateRequestBudget` calculates `hardInputLimit` given the model context window, output reservation, and safety allowance.
3. **Headroom filtering:** Candidates with insufficient headroom (`estimatedInputTokens > hardInputLimit`) are filtered out. If one or more fitting candidates exist, soft preference selects among the `fitting` subset.
4. **No-fit and compaction recovery:** If no candidate can fit the current messages:
   - Auto selects the candidate with the **largest input capacity** to give Core compaction maximum headroom.
   - Its in-memory routing decision includes a structured diagnostic (not a new durable event):
     - `fixed-content-cannot-fit`: the latest user turn alone exceeds maximum capacity and cannot be compacted away.
     - `compaction-unavailable`: compaction is disabled or has zero retries configured.
     - `attempted-but-still-oversized`: a compaction summary already exists in history and the turn remains oversized.
     - `compaction-eligible`: prior history is compressible and downstream dispatch will trigger compaction pressure.
5. **Final framing limitation:** At routing time, only messages are estimated; downstream `system-prompt/assemble` injects system prompt instructions and tool schemas. If final framing pushes a near-limit request over the budget, the native provider guard (`inspectRequest`) truthfully rejects the request with `COPILOT_CONTEXT_BUDGET_EXCEEDED` without bypassing safety boundaries.

### Soft capacity preferences across candidate bands

All three virtual preferences use the *same* eligible account models. Account entitlement, verified input capability (including image input), and input headroom are hard filters; preference changes where the routing policy lands in the deterministic, advertised-capacity order across candidate bands:

- **Intelligence:** Biased toward higher advertised capacity across the upper candidate band.
- **Efficiency:** Biased toward lower advertised capacity across the lower candidate band, though demanding tasks allow higher capacity.
- **Balance:** Central candidate band.

To avoid monopolizing a single top candidate (such as Grok 4.7) across all turns and Sessions, band selection uses an in-memory deterministic seed derived from `${sessionId}:${turn}` (or turn content when Session context is absent). This guarantees:

- Selection is **100% frozen** across all steps and retries within the same turn.
- Unrelated Sessions or turns sample across the candidate band rather than concentrating on one model.
- No sensitive prompt text or seed hashes are persisted or sent over the network.
- When only a single candidate is eligible or fitting, it is returned unchanged.

| Latest-turn class | Efficiency | Balance (`auto`) | Intelligence |
| --- | --- | --- | --- |
| Fast | low band (index 0) | low band (index 0) | middle band |
| Balanced | lower band | center band | upper band |
| Strong | center band | upper band | upper band |

These are **capacity preferences**, not measured quality, speed, price, or inference-cost preferences. They cannot promise that Intelligence is smarter or Efficiency faster or cheaper. The actual request-budget and compaction checks still apply after selection; no cost or speed metadata is fabricated.

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

The guarantee is limited to compressible history. A fixed prompt, current attachment, or indivisible content block that cannot fit after compaction remains an explicit error. See [Copilot compaction](./copilot-compaction.md).

## Search ownership

Chat Auto does not own or alter the independent `github-copilot-hosted` search provider.

- A nonempty explicit `searchModel` remains authoritative.
- Automatic hosted-search candidate selection continues to use its own bounded account-owned Responses policy and capability proof.
- Routed search that follows the initiating Chat request sees the durable real request header, not the virtual Auto ID.
- The final query is still sent once; Chat Auto introduces no search replay or fallback.

## Attribution and explanation

**Compatibility fix (alpha.54):** new turns omit plugin-specific Auto decision events. Official `0.2.0-rc.2` cannot set an `ignorable` envelope through public `Session.append()`, and its reader rejects unknown required plugin events. The plugin therefore stops writing `github-copilot/auto-model-decision` rather than patching Core, mutating event objects, or borrowing an unrelated event type. Core's actual model/usage provenance and Auto routing remain unchanged. Restore new decision recording only when a supported public informational-event or equivalent storage seam has proven cold-read compatibility.

Completed Copilot replies show **Auto (preference)** with an information button, **Manual** with captured explicit fixed-selection evidence, or **Selection unknown** when that evidence is absent. The public `conversation.chat.assistant-actions` slot places the plugin's own flex item after native Usage/time using `order: 1`. There is no separate Model details entry or repeated model name. The native parent is a fixed-height, non-wrapping row: the plugin can shrink/wrap its own item but cannot promise whole-row wrapping, and does not modify native ancestors. A turn without a closing message has no assistant-actions anchor.

New Auto decisions and matching explicit fixed selections are captured at dispatch in a bounded in-memory store (64 Agents, 128 turns per Agent, first decision per turn). `githubCopilotTurnSelection.get` uses Core's native agent scope and lookup, with its existing Session resolution and ownership checks, rather than a plugin-owned arbitrary-session metadata endpoint. The lookup can use normal Core resume semantics; it is not a new access-control system. The Client reads once for the exact displayed Session/turn, cancels stale responses and never polls. Agent disposal, plugin disposal, eviction or Host restart removes evidence; no new Session event is emitted. Compatible historical Auto events can supply a recorded preference and reason; omitted historical preference is not guessed.

The expandable explanation reports only the actual routing classification, capacity preference and eligible/fitting counts. It is selection evidence, **not proof of execution**. Absence of Auto evidence never implies Manual, and today's picker/request header never fills a historical gap. Native Usage remains the only model/usage display; its existing all-or-nothing missing-route behavior is not fixed here. A metadata-only projection flags incomplete attempts/history without duplicating or allocating tokens. The disclosure never reads message content, replay data or credentials.

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

In official DSH 0.2.0-rc.2, `TeamRoster.spawn` calls `ctx.subagents.startContinuable` without `request.agentOptions`. Core's `resolveChildAgentOptions` snapshots the parent's resolved concrete route into the teammate's options and durable descriptor. Public Core evidence cannot distinguish an inherited concrete snapshot from an explicit concrete override. The plugin must not relabel that concrete child route as Auto or write a fabricated child selection.

The implementation preserves native behavior:

- a child with an explicit model override uses that model;
- a child or Team teammate without an override inherits Core's resolved concrete route;
- the child UI shows the real model truthfully;
- no plugin code claims independent child Auto classification.

A later plugin-owned delegation entry may carry explicit Auto intent in its own public descriptor and let each child classify independently, but only after cold-resume and override precedence are proven without Core changes.

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
- user-managed exclusions of individual account models and custom picker grouping;
- cross-provider routing;
- native subagent and Team Auto inheritance;
- model fallback after a provider failure;
- side-effect replay;
- automatic changes to existing Session selections, settings, or histories.

## Model exclusions and richer picker boundary

**Tracking:** [#192](https://github.com/cloga/dsh-github-copilot/issues/192). **Interactive proposal:** [`output/auto-model-mockup/tiers.html`](../output/auto-model-mockup/tiers.html). This is a local, synthetic UI exercise, not a claim of current Core picker behavior. The three virtual preferences, capacity matrix, and plugin-owned model exclusions are implemented. The mockup's nested Core picker is not.

The attached Copilot example uses one Auto switch with a nested Efficiency / Balance / Intelligence menu. The supported DSH model picker is owned by Core and receives a flat provider directory from `PreviewAdapter.listModels()`; the plugin's Models provider-card and bundle-config slots cannot restructure that picker. The plugin advertises three rows under **GitHub Copilot**, with the existing `auto` ID as Balance for previously selected Sessions and defaults. A nested switch like the screenshot requires a separately reviewed public Core UI seam and is not a dependency of the plugin-only preferences.

Exclusions are a separate **hard filter**, not a fourth preference. All three preferences share account entitlement and turn-required verified capabilities, then remove the exact IDs stored in `github-copilot.excludedModelIds`. The mockup uses illustrative capacity scores and simulated responses, not live evaluation of model quality, cost, or latency.

The model-management surface is the nested **GitHub Copilot → Manage → Model preferences** disclosure in the plugin's own settings UI, not a replacement of Core's picker. It offers local search, visible/excluded counts, **Exclude** and **Restore**, a selected-model lock reason, and retained restore rows for exact IDs temporarily absent from current account metadata. Writes are revision-checked path mutations. The plugin does not mutate pi-ai's catalog, the account grant, Core settings, or another provider's models. Its advertised directory, every Auto candidate set, aggregate Auto modalities, hosted-search route facts and managed admission remove excluded IDs. A stale picker row or direct request fails with `COPILOT_PREVIEW_MODEL_EXCLUDED`. Existing Session history is never rewritten or silently moved. The current fixed managed model cannot be excluded until another model is selected. If exclusions leave no eligible candidate, Auto fails closed with `COPILOT_AUTO_NO_ELIGIBLE_MODEL`. Account change or unavailable metadata never re-enables or guesses models.

The native picker still owns provider groups and text search. It remains flat: the three virtual rows are listed first and excluded Copilot models are omitted from the plugin-owned directory. Custom section headers inside a provider, nested Auto menus, hiding other providers' models, and replacing Core search/layout are **not** available through the current additive slots. Focused regressions cover directory refresh, selected-model exclusion, stale direct requests, concurrent settings conflicts, Auto/image eligibility and zero-candidate failures against unchanged pinned Core. The prototype's invented model capacity order and response remain illustrative only.
