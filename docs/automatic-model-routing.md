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
   - It records a structured diagnostic in the decision event:
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

The exact virtual preference stays in the Session's pending selection across turns, while each real request header and transport record the chosen account model. The durable decision event also records the preference, candidate counts, input budget, and input fit diagnostic. Switching to a real model ends automatic routing for subsequent turns.

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

Core already places route and usage details at the end of a completed turn. The MVP follows that interaction pattern rather than adding provider/model tags above the answer.

For a completed Auto response, the attribution sits on the same footer row as Core's usage and clock, after the end time. It stays hidden until the message is hovered or focused, matching that chrome. It is not a separate line above the answer. The turn-tail display is:

```text
[actions] [usage] [time]  Auto · <actual model>  ?
```

The `?` opens a compact explanation using normalized facts such as:

- short text turn;
- standard turn;
- large structured turn;
- image capability required;
- number of eligible account models;
- number of models that can fit turn context (when restricted by input headroom).

The plugin records a credential-free `github-copilot/auto-model-decision` Session event before Core persists the real request header. Historical attribution is derived from that durable decision plus assistant/request provenance, never from the current picker or a later catalog snapshot. Raw prompts, credentials, provider response bodies, and guessed prices are never disclosed.

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
9. the turn-tail attribution is derived from durable decision/provenance data and is hidden for explicit model turns.
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

## Exploration: excluded models and richer picker (not implemented)

**Tracking:** [#192](https://github.com/cloga/dsh-github-copilot/issues/192). **Interactive proposal:** [`output/auto-model-mockup/tiers.html`](../output/auto-model-mockup/tiers.html). This is a local, synthetic UI exercise, not a claim of current Core picker behavior. The three virtual preferences and capacity matrix above are implemented; model exclusions and nested picker controls in the mockup are **not**.

The attached Copilot example uses one Auto switch with a nested Efficiency / Balance / Intelligence menu. The supported DSH model picker is owned by Core and receives a flat provider directory from `PreviewAdapter.listModels()`; the plugin's Models provider-card and bundle-config slots cannot restructure that picker. The plugin advertises three rows under **GitHub Copilot**, with the existing `auto` ID as Balance for previously selected Sessions and defaults. A nested switch like the screenshot requires a separately reviewed public Core UI seam and is not a dependency of the plugin-only preferences.

The proposed exclusions are a separate **hard filter**, not a fourth preference. Today all three preferences share account entitlement and turn-required verified capabilities; no exclusion setting has been wired. The mockup uses illustrative capacity scores and simulated responses, not live evaluation of model quality, cost, or latency.

The model-management surface should be a small **GitHub Copilot · model preferences** section in the plugin's own settings UI, not a replacement of Core's picker. Offer search, a visible/hidden count, **Exclude** and **Restore** per currently validated account model, and a reason when an action is unavailable. Store excluded **exact account model IDs** in a plugin-owned path with revision-checked writes; validate entries against the current directory and preserve exclusion intent for temporarily absent IDs without pretending they are entitled. Do not mutate pi-ai's catalog, account grant, Core settings, or another provider's models. The plugin's advertised directory and every Auto candidate set exclude these IDs. A stale picker row or direct request for an excluded model must also fail with a named, actionable diagnostic rather than silently routing through it. Existing Session history is never rewritten: an old fixed selection can be restored or changed explicitly, but is not automatically moved. Prevent excluding the currently selected fixed model until another selection is made; allow restoring an excluded model. If exclusion or catalog changes leave no eligible candidate, Auto must fail closed. Account change and unavailable metadata must not be interpreted as permission to re-enable or guess models.

The native picker already owns provider groups and text search; listing the three virtual rows first and keeping excluded Copilot models out of its directory is achievable through the existing plugin-owned adapter. Custom section headers inside a provider, nested Auto menus, hiding other providers' models, and replacing Core search/layout are **not** available through the current additive slots. Before implementing, verify cold picker and `/model` refresh behavior, Session-local pending selection versus real request headers, selected-model exclusion, stale directories, concurrent settings edits, account switching, image admission, and zero-candidate failures against unchanged pinned Core. The prototype's invented model capacity order and response are illustrative only.
