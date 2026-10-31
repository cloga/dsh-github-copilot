# HydraFusion integration readiness

## Decision

Do not expose HydraFusion or HydraFusion Max as selectable models through the
current plugin route. The SDK's ordinary model catalog does not identify Fusion
orchestration choices, but its distinct session-scoped `model.list` response
can include account/runtime tier descriptors under `auto.tiers`. A pure,
fail-closed mapper now recognizes eligible Fusion descriptors from that shape.
This establishes a discovery seam only: it does not show that a particular
account advertises a tier, that a descriptor can be applied as a separate
Fusion choice without changing native Auto, or that DSH can safely own the
resulting execution.

This is a plugin/API boundary finding, not evidence that Fusion is unavailable
to a Copilot account or that the SDK cannot execute it. No runtime, account, or
inference was exercised.

## Published SDK evidence

The inspected release is [`@github/copilot-sdk` v1.0.28], tag commit
`fa108e71ee3025663e0dac20f2a071055d3a6b14`, published 2026-10-28. The release
notes identify an SDK snapshot update to Copilot CLI `1.0.105-1`.

- [`ModelInfo`](https://github.com/github/copilot-sdk/blob/v1.0.28/nodejs/src/types.ts#L4066-L4081)
  contains `id`, `name`, capabilities, optional policy and billing, and
  reasoning-effort metadata. It has no provider-kind, orchestration-kind, or
  Fusion-entitlement discriminator. This is the ordinary catalog, not the
  session-scoped model-list RPC.
- [`session.rpc.model.list()`](https://github.com/github/copilot-sdk/blob/v1.0.28/nodejs/src/generated/rpc.ts#L29458)
  returns `SessionModelList`, whose optional `auto` metadata contains ordered
  `AutoTierDescriptor` entries
  ([type](https://github.com/github/copilot-sdk/blob/v1.0.28/nodejs/src/generated/rpc.ts#L9287-L9359)).
  These descriptors can carry an opaque `id`, display data, a runtime Fusion
  execution `type`, optional `fusionTier`, and status including `enabled` and
  `pickerVisible`. This is the supported discovery avenue missed by the
  earlier ordinary-`ModelInfo` conclusion. The plugin mapper
  (`src/hydrafusion-descriptors.ts`) accepts only exact `type: "fusion"` entries
  with a bounded opaque ID, display name, explicit `status.enabled: true`, and
  no explicit picker hiding; duplicate IDs and malformed/incomplete entries
  are excluded. It preserves server order and labels and never invents IDs.
  Synthetic mapper tests are not evidence of live account availability.
  The mapper is currently tested against synthetic values matching this
  documented shape; it has not been compiled or exercised against the exact
  SDK package, so discriminator compatibility still requires a credential-free
  package fixture.
- [`CopilotSession.setModel`](https://github.com/github/copilot-sdk/blob/v1.0.28/nodejs/src/session.ts#L2790-L2827)
  accepts `model: string`. Its `autoTier` option is documented for `model:
  "auto"`. `session.rpc.model.setAutoTier()` changes the session Auto
  configuration, and a pending response is not evidence that the change has
  committed. Neither API establishes a safe way to expose a Fusion descriptor
  as a separate picker choice while preserving the DSH parent's ordinary Auto
  selection. Do not write to the parent's Auto configuration or treat a
  descriptor ID accepted by a string parameter as proof of successful
  selection. The mapper intentionally performs no selection or RPC.
- The SDK declares experimental Fusion route, resolution, phase, and completion
  events. For example, [`FusionRouteStartedData`](https://github.com/github/copilot-sdk/blob/v1.0.28/nodejs/src/generated/session-events.ts#L4980-L4997)
  reports a routing attempt and optional synthetic-model label;
  [`FusionResolvedData`](https://github.com/github/copilot-sdk/blob/v1.0.28/nodejs/src/generated/session-events.ts#L5099-L5210)
  reports the resolved route; and [`FusionCompletedData`](https://github.com/github/copilot-sdk/blob/v1.0.28/nodejs/src/generated/session-events.ts#L5310-L5389)
  includes aggregate usage and final-source fields. These are execution
  evidence, not account discovery or a model-picker catalog. The declarations
  alone do not prove that the events arrive through a DSH-owned turn or that
  their lifecycle and billing semantics match native DSH ownership.

## DSH integration boundary

The plugin's existing Copilot account and pi-ai provider remain the only
credential owner. Introducing the SDK runtime would also introduce a separate
session and tool-execution owner. Static/session SDK token inputs do not by
themselves establish account binding, revocation behavior, or a truthful token
lifetime for a long-running session. A token-provider callback that requires a
positive expiry cannot be populated from an unrelated expiry value.

The public DSH subagent seam represents explicit delegation, not a transparent
replacement for a native Chat model. Using it for Fusion would still require
separate proof of tool permission parity, exact-once tool results, cancellation
quiescence, durable-history ownership, final-answer correlation, and complete
Usage attribution. The retained `src/dual-model-host.ts` code is a retired
planner/executor compatibility path: it can start a native continuable child
with a fixed route and tool allowlist. Its tests mock child creation and prove
DSH-side policy boundaries only; they do not start an SDK session, consume
Fusion descriptors, bridge SDK tool calls through `ToolRuntime`, or prove
cross-runtime cancellation-to-idle, final-answer, history, or Usage ownership.
No DSH/SDK bridge is implemented or qualified here.

## Requirement status

| Requirement | Status |
|---|---|
| Preserve existing Auto choices | Preserved by the existing read-only status card; no model registration was added. |
| Show only exact account/runtime-advertised Fusion choices | Discovery mapping implemented for public Session `model.list` `auto.tiers`; actual account visibility is not verified, and the current UI remains read-only. |
| Select Fusion without a guessed ID | Partially supported at descriptor level: opaque runtime IDs are retained. A separate-choice selection operation that preserves ordinary DSH Auto and confirms commitment is not qualified or implemented. |
| Use the existing DSH login only | Existing credential ownership remains unchanged; SDK account binding and token lifetime are not qualified. |
| Runtime-evidence-only route/phase progress and details | SDK event types exist, but no event bridge to a DSH-owned conversation exists. |
| One final answer with truthful fallback/cancel/failure outcomes and Usage | Not implemented: SDK event declarations do not establish end-to-end DSH message, cancellation, or accounting ownership. |
| Fresh-task-only execution | No SDK-backed execution was started or added. |
| Credential-free DSH-to-SDK turn/tool/cancellation proof | Not established; existing DSH child tests use a mock and do not exercise SDK requests or Fusion execution. |
| Real Fusion runtime/account qualification | Not run; no live account, paid inference, installation, or runtime was used. |

## Remaining gates

1. A credential-free SDK fixture against the exact supported package must
   confirm `session.rpc.model.list()` decoding and the semantics of the accepted
   Fusion `type` value. The mapper currently has only synthetic-shape tests.
   Then an account/runtime observation must establish
   whether actual enabled, picker-visible Fusion descriptors exist; neither
   has been performed here.
2. The SDK must provide a separate-choice selection path that does not mutate
   the DSH parent's normal Auto configuration and reports committed rather
   than merely pending selection.
3. The chosen execution path must bind to the existing selected DSH account
   without ambient login or copied credentials and must handle revocation and
   expiry without guessed lifetimes.
4. A credential-free adapter fixture must prove existing-account binding
   without credential copying, tool authorization, late-result fencing,
   cancellation-to-idle, one final answer, fallback classification, and
   complete native Usage/history ownership.
5. Exact-head Windows/Linux CI and the published-adapter matrix must pass before
   any merge. Separately authorized live acceptance is required before claiming
   account availability or Fusion execution.

[`@github/copilot-sdk` v1.0.28]: https://github.com/github/copilot-sdk/releases/tag/v1.0.28
