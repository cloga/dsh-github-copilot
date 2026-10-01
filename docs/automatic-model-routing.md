# GitHub Copilot Auto model routing MVP

**Tracking:** [#174](https://github.com/cloga/dsh-github-copilot/issues/174)

**Target:** official DSH and Windows Desktop `0.2.0-rc.2`

**Boundary:** plugin-only; no Core source, artifact, registry, prototype, or history patch

**Interactive mockup:** [`output/auto-model-mockup/index.html`](../output/auto-model-mockup/index.html)

## User contract

The managed `github-copilot-preview` provider contributes one virtual model named **Auto** to the ordinary model picker. Auto never appears under another provider and never routes across providers or accounts.

Selecting Auto uses normal Core selection behavior, including saving it as the future default selection. For every Core turn, the plugin resolves Auto to one real model from the authenticated account catalog:

- one decision is made for the turn;
- every model request, tool continuation, request-error retry, and compaction retry in that turn uses the same real model;
- a later user turn or Goal continuation is a new turn and may select a different model;
- an explicit real model selection always wins;
- the actual model remains the provider transport, usage, replay, and billing identity.

A Goal does not become one indefinitely frozen Auto decision. Each automatic continuation that Core opens as a new turn is classified independently. Tool steps inside that turn do not trigger another decision.

## MVP routing policy

The account `/models` catalog is authoritative for entitlement and hard capabilities: protocol, context and output limits, image input, tool support, reasoning efforts, and server policy. Unknown or incomplete capability metadata fails closed.

The catalog does not provide trustworthy quality, latency, price, or global-health rankings. The MVP therefore does **not** infer model quality from a marketing name, model-ID prefix, provider order, or token price. It does not claim to reproduce GitHub's private Auto algorithm.

The initial deterministic policy classifies only the latest user turn:

| Class | Structural signal | Selection |
| --- | --- | --- |
| Fast | short text turn with little structured content | lowest eligible advertised capacity |
| Balanced | ordinary text turn or image turn | median eligible advertised capacity |
| Strong | large or highly structured text turn | highest eligible advertised capacity |

Capacity ordering is based on account-advertised reasoning range, context window, and output capacity, with model ID used only as a deterministic tie-breaker. Capacity is not presented as a quality, latency, or cost fact. The policy is intentionally replaceable by reviewed benchmark evidence later.

The MVP makes no additional model call to classify a turn. It does not retry another model after provider output begins, replay tool side effects, or implement wire-time fallback.

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

For a completed Auto response, the proposed turn-tail display is:

```text
Auto · <actual model>  ?
```

The `?` opens a compact explanation using normalized facts such as:

- short text turn;
- standard turn;
- large structured turn;
- image capability required;
- number of eligible account models.

The plugin records a credential-free `github-copilot/auto-model-decision` Session event before Core persists the real request header. Historical attribution is derived from that durable decision plus assistant/request provenance, never from the current picker or a later catalog snapshot. Raw prompts, credentials, provider response bodies, and guessed prices are never disclosed.

## Subagents

General native subagent Auto inheritance is **not** in the base MVP.

Core currently creates a native child from the parent's effective real request configuration. Continuable descriptors retain the merged provider/model/effort but do not preserve enough public evidence to distinguish inherited Auto intent from an explicit child override that happens to equal the same real model. The plugin must not relabel that concrete child route as Auto or write a fabricated child selection.

The MVP therefore preserves native behavior:

- a child with an explicit model override uses that model;
- a child without an override inherits Core's resolved concrete route;
- the child UI shows the real model truthfully;
- no plugin code claims independent child Auto classification.

A later plugin-owned delegation entry may carry explicit Auto intent in its own public descriptor and let each child classify independently, but only after cold-resume and override precedence are proven without Core changes.

## Public API implementation

The plugin uses only published public seams:

- `PreviewAdapter.listModels()` publishes the virtual Auto picker entry alongside real account models.
- `PreviewAdapter.resolveModel()` returns aggregate Auto modalities for picker admission.
- `agent/pre-step` captures the admitted current-turn messages.
- a prepended `agent/request` listener awaits Core's model-selection middleware, recognizes only `github-copilot-preview/auto`, resolves one real account descriptor, and returns the real model before `request/header` persistence.
- the adapter refuses unresolved Auto in `prepareCall()` and `stream()` so a missing middleware path fails loudly.
- a per-Agent, per-turn decision cache keeps all later steps and request-error retries on the same model.
- existing descriptor leases, credential proof, account continuity, request budgets, native pi-ai transport, replay, and cancellation remain unchanged.

The virtual Auto selection can remain pending while the real request header records the actual model. This is intentional: an unrelated real header must not consume the durable Auto preference. A later explicit picker selection replaces the pending Auto choice through Core's normal projection.

For an otherwise unselected Session that inherits Auto from the global default, the first virtual request persists a `model/selection` Auto intent before its real request header. Core's request-header fallback would otherwise make the next turn fixed. The plugin restores the pending Auto route during subsequent prompt assembly and request resolution without changing the real header, and yields immediately to a later explicit selection. It does not turn an existing Session with a real recorded route into Auto just because the global default changed.

## Acceptance criteria

The MVP is accepted only when unchanged official Core contract tests prove:

1. Auto appears only in the managed Copilot provider and explicit real/provider selections remain untouched.
2. Core's downstream model-selection result is visible to the prepended plugin listener, and the committed request header contains the resolved real model.
3. Auto intent remains durable while actual request provenance remains real.
4. one turn with multiple steps or request-error retries loads one routing decision.
5. a new user or Goal turn may make a new decision.
6. image admission and real candidate filtering agree, including the no-image-candidate failure.
7. choosing a smaller-context model can trigger the existing local pressure signal, Core compaction, and same-model retry without sending the oversized request.
8. hosted search remains independent and never receives the virtual Auto ID as a transport model.
9. the turn-tail attribution is derived from durable decision/provenance data and is hidden for explicit model turns.
10. no Core file, dependency artifact, private registry, shared model catalog, or live history is modified.

Synthetic tests prove composition and contracts only. They do not prove a live account's model availability, provider quality, pricing, OAuth readiness, Desktop activation, or real transport success.

## Deferred work

- benchmark-backed quality/latency/cost ranking;
- GitHub health signals or GitHub's private Auto service;
- user-selectable Efficiency/Balance/Intelligence tiers;
- cross-provider routing;
- native subagent Auto inheritance;
- model fallback after a provider failure;
- side-effect replay;
- automatic changes to existing Session selections, settings, or histories.
