# Copilot account usage

The optional composer control separates three quantities:

| Quantity | Scope | Rule |
| --- | --- | --- |
| Context occupancy | Current native request/context window | Remains owned by DSH's native meter. |
| Account usage and remaining allocation | GitHub account billing cycle, across Copilot applications | Display only validated provider quota data; identify stale snapshots explicitly. |
| Session credits | Complete provider-reported usage attributable to this DSH Session | Not displayed because the supported adapter does not supply it. Do not infer it from tokens, cost estimates or account balance changes. |

## Presentation

The control is an additive `conversation.composer.dock` contribution for the current Copilot Session. It does not replace the composer, move native DOM nodes, modify global defaults, switch a model or enroll other Sessions. Native context occupancy and the new account budget are not interchangeable.

The compact control shows reported usage and remaining allocation where available. Its details explain the unit, budget, reset timestamp, freshness and unavailable data. Legacy premium requests must never be relabeled AI credits. A pooled organization account can have absolute credits used without a personal denominator; it does not imply unlimited use or expose a knowable organization balance. Percentage-only data must not create falsely precise absolute amounts.

Detailed amounts are rounded to two decimal places for display; a positive amount below 0.01 is shown as `<0.01`, not zero. GitHub billing remains authoritative. Known individual budgets at 90% used show a low-budget warning, not a spending restriction. The plan link uses the supported Desktop browser handoff with a selectable URL fallback. Details use the browser's native popover top layer when available and a fixed-position fallback otherwise; no additional ReactDOM copy or private Core DOM access is introduced.

Provider or Session changes, unmounting and missing supported runtime seams revoke the presentation's ownership. Optional capability failure must not disable sign-in, Models, search or ordinary chat. The installed/loaded Client determines the exact dock placement; the standalone design mockup is not proof of native placement.

## Historical context evidence

Official rc.2 can replace the native context-pressure sample with the adapter's all-zero usage on a failed attempt. The message breakdown is a separate heuristic projection, so a native `0%` reading can coexist with substantial message tokens. Neither that zero nor the breakdown proves the current exact occupancy.

The managed route preserves native usage chunks immediately, including all-zero samples before error or aborted finishes. Usage is shared accounting evidence, not a context-only signal. The former terminal-zero filter was removed in alpha.87 (#270): dropping a sample to protect context pressure also made Core's whole-turn accounting unavailable. Numeric zero alone cannot distinguish the SDK's default from an explicit supplier report, so the plugin neither deletes it nor certifies it as a billing receipt. Native context pressure may consequently show zero after failure; the separate disclosure explains uncertainty instead of modifying Core's meter. No retry, compaction, trimming or model switch is added.

The separate, strict `githubCopilotContextEvidence` session projection reads only routing and numeric usage from ordinary durable events. It keeps the last applicable input-plus-cache sample when a failed all-zero attempt is replayed. Model changes, compaction, surface replacement, conflicting source attribution and invalid metadata revoke the sample. It never reads message content or opaque replay, registers under a Core key, changes the native pressure projection, or rewrites durable history.

An additive composer disclosure identifies missing or unreliable context evidence for the current open Copilot Session. Any retained count is explicitly a **historical input sample, not current occupancy**; no capacity or percentage is inferred. The native context ring and account Credits control remain separate and unchanged. Missing public projection/slot/runtime seams produce named diagnostics rather than guessed counts. Old histories can therefore still show native `0%`; the disclosure explains the uncertainty instead of claiming an in-place native-meter repair.

Local synthetic tests establish native-stream preservation, historical-fold and presentation behavior only. Exact published-adapter and public-registry acceptance, complete CI, publication and loaded Desktop state must be verified separately. No live provider call or Session restart is needed for these tests.

## Missing completed-turn Usage

### Observed plugin/Core integration gap (#259)

One observed completed turn contained 57 successful assistant messages with reported usage and one failed `assistant/attempt` without a usage sample. That attempt recorded the plugin's exact local estimated-input-budget diagnostic: 796299 estimated tokens exceeded a 781113-token input budget, before provider dispatch. Native compaction recovered and the subsequent steps completed. No conversation content, credentials or opaque replay is needed to explain this observation; the exact loaded plugin bytes were not independently attested.

Official rc.2 `deriveTurnTokenUsage` requires complete lifecycle and exact usage for every attempt. One attempt without a sample makes its whole-turn result unavailable, so `TurnTailNodeView` omits native Usage. This is Core's existing fail-closed accounting rule triggered by our preventive pressure path, not evidence that all requests had no usage and not a regression in single-model exclusion saves.

### Cancelled and failed terminal samples (#270)

Cancellation does not inherently disable official rc.2 turn accounting: a complete lifecycle with a valid sampled aborted attempt remains eligible. Before alpha.87, the managed terminal-zero filter removed such samples. For example, a successful 120-token step followed by a zero-sampled cancelled step retained Session cumulative counts but lost the entire turn total after filtering. The route now forwards native samples unchanged; historical context evidence still treats failed zero as unreliable, independently of accounting.

This is not a promise that every cancelled turn has complete or exact supplier usage. Responses may end before the supplier's final receipt and the SDK may emit its initialized zero. Missing lifecycle, unsampled attempts, pre-dispatch budget failures and native/plugin timeout interruption remain distinct limitations. No prior history is rewritten and no missing sample, partial total or billing amount is invented. Existing native usage already emitted before an error must not be removed for context-only diagnostics.

### Plugin-local explanation

A plugin-owned public conversation definition retains bounded counts of settlements without reported samples and finish-only attempts with the exact recorded local diagnostic. On a completed Copilot reply whose native tail has no `tokenUsage`, the additive assistant-actions control opens **Turn Usage incomplete** (previously **Turn Usage unavailable**). It uses the incumbent nonmodal popover pattern rather than expanding the native fixed-height footer.

The explanation distinguishes recorded local budget blocks, same-settlement request-body timeout diagnoses, other settlements without samples, and missing turn-start/projection evidence. A timeout is recognized only from the shared bounded plugin diagnostic marker on that settlement's unambiguous error finish, never from a neighboring message, generic `408` text or cancellation. The disclosure copies no raw failure text or payload. It retains at most eight timeout details containing only recorded step/event sequence numbers and a recovery boolean, while keeping the full saturating diagnostic count. These are original record coordinates, not invented attempt numbers or navigation links. Unknown coordinates remain unknown. Older count-only projections remain readable; projection state version 2 requests refolding without converting history.

A successful retry claim requires strictly increasing event sequences and the same turn/step through the failed `assistant/attempt`, `llm/retry`, matching `llm/retry-started` (same retry ID and ordinal), and an `assistant/message` with an unambiguous successful `stop` finish. Missing, interrupted or mismatched chains remain uncertain. A later arbitrary successful reply or another step is not recovery evidence. This intentionally conservative recognition does not claim that an unrecognized retry failed. Even a confirmed retry cannot fill the failed attempt's usage; the native whole-turn total stays unavailable and billing remains unknown.

Generic provider overflow is never labeled pre-dispatch. Invalid reported samples and missing lifecycle boundaries can also make native accounting unavailable; if no cause is established, the explanation remains unknown rather than reimplementing the native validator. Projection and selection Remote failures remain independent, with named diagnostics; Retry only rereads selection evidence, never inference or accounting.

The control is historical evidence, not current context occupancy, account credits, dispatch attestation or a supplier receipt. It adds no token sum or fabricated zero usage, changes no native projection key, reads no opaque replay, and rewrites no history. Native complete Usage suppresses the explanation. Ordinary pressure protection, compaction transactions, errors, cancellation and retry remain unchanged. Removing the plugin removes the explanation without a data migration.

Synthetic unit/UI tests and exact unchanged Core accounting/registry fixtures prove these boundaries, not live provider receipts or loaded Desktop behavior. A native representation for unbilled pre-dispatch attempts may eventually remove the gap, but would require a separately requested upstream scope; it is not a prerequisite for this plugin-local explanation. Retire the companion diagnostic when native public presentation communicates the same uncertainty and the supported-version acceptance is verified.

## Account data boundary

The Host uses the existing `llm-pi-ai/github-copilot` OAuth grant through public credential APIs. GitHub's `copilot_internal/user` endpoint uses the GitHub grant, not a second sign-in or a newly pasted token. Access-token renewal remains owned by pi-ai; quota inspection must not introduce a refresh implementation or credential persistence.

Quota requests are lazy, single-flight and bounded by timeout, response size and cache/failure policy. Account continuity is checked around asynchronous work and before releasing cached data. Authentication denial, sign-out, account invalidation or disposal must not release a previous account's snapshot. A same-account transient failure may expose a timestamped last-known snapshot, never a current balance. Responses and diagnostics exclude tokens, raw provider bodies and account identifiers. Requests do not follow redirects with the credential; custom enterprise hosts are not guessed.

The plugin's default quota fetch lazily creates one request-scoped Undici agent for `https://api.github.com/copilot_internal/user`. It unions and deduplicates `tls.getCACertificates('default')` (including any configured extra CA certificates) and `tls.getCACertificates('system')`, with `rejectUnauthorized: true`. Node 22.19.0 provides both CA APIs; Undici 6 supports that runtime floor. The agent is reused for refreshes and destroyed on controller disposal. Injected test fetchers bypass the agent. No global dispatcher, environment variable, Desktop trust preference, model/search transport or credential owner is changed.

This removes reliance on a Desktop launcher inheriting `NODE_USE_SYSTEM_CA=1` for **quota requests only**. On a machine where Watt Toolkit / Steam++ installs a trusted Windows root, quota worked under a correctly environmented launch, then failed when a recovery launcher omitted the process variable despite its persistence in HKCU; a normal manual relaunch restored quota. That is operational evidence for the launcher-inheritance explanation, not proof that this new plugin build has been installed or loaded. Other Desktop traffic, including sign-in and models, still follows its existing process-level trust configuration. If system CA retrieval or agent creation fails, the quota shows `COPILOT_USAGE_TRUST_UNAVAILABLE` without issuing a request or weakening TLS. Certificate verification failures still show `COPILOT_USAGE_TLS`; other fetch failures remain `COPILOT_USAGE_NETWORK`. No diagnostic alone proves proxy routing, authorization or a live balance. Inspect approved Host trust/proxy settings without disabling TLS validation. When unavailable, details show guidance instead of implying a budget. The popover background is opaque even if the host's menu token contains transparency.

The Client receives only the separate strict `githubCopilotUsage` namespace (`get` and `refresh`). Existing authorization and migration methods retain their schemas. Refresh does not change settings, budget, plan, model selection or billing policy. This meter is informational and does not authorize spending or implement a budget enforcement loop.

## Source contracts and limitations

GitHub's internal client endpoint is not a stable public third-party REST contract. The existing grant may not be permitted to read it, and its schema may change. Failure must remain visible rather than falling back to an administrator token, another account, a browser token or fabricated numbers.

Verified reference sources:

- [Official VS Code account snapshot types](https://github.com/microsoft/vscode/blob/44825207bf4389c3bd17c92d3ec28cf784c324cc/src/vs/base/common/defaultAccount.ts).
- [Official quota normalization and pooled-account semantics](https://github.com/microsoft/vscode/blob/44825207bf4389c3bd17c92d3ec28cf784c324cc/src/vs/workbench/services/chat/common/chatEntitlementService.ts).
- [Official quota fetch and per-turn credit accounting](https://github.com/microsoft/vscode/blob/44825207bf4389c3bd17c92d3ec28cf784c324cc/extensions/copilot/src/platform/chat/common/chatQuotaServiceImpl.ts).
- [GitHub's public organization/enterprise usage reporting API](https://docs.github.com/en/rest/copilot/copilot-usage-metrics) and [report fields](https://docs.github.com/en/copilot/reference/copilot-usage-metrics/copilot-usage-metrics). Daily administrator reports are not a live personal balance API.
- [GitHub's explanation of used credits with no individual budget](https://github.blog/changelog/2026-07-20-copilot-users-can-now-see-ai-credits-used-per-billing-cycle/).

The internal client observes per-turn `copilot_usage.total_nano_aiu`, but existence in another client's wire response is not evidence that the supported DSH/pi adapter exposes complete session accounting to plugins. On the exact alpha.2 source, [`mapUsage`](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm-pi-ai/src/stream.ts) maps only token counts and cache counts into the public [`StreamChunk` usage contract](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm/src/types.ts). Opaque replay state is not an accounting escape hatch. Until an unchanged public seam provides attributable, deduplicated receipts for ordinary calls, retries and background activity, per-session credit values are not displayed.

Synthetic tests cover parsing, lifecycle, failure states, strict transport and UI. They do not establish production quota permissions, billing latency, live OAuth/model transport, installed Desktop bytes or loaded plugin state. No real account calls are made merely to generate test evidence.

## Session selector correction (alpha.33)

Alpha.32 called `useSession()` without the selector required by the public Core hook. A registration can therefore exist while the Slot renderer has retired its crashed entry; installed-version receipts and signed-out absence tests are not proof that the control renders in an eligible Session.

The correction consumes the existing `useSession(selector)` contract and selects only a boolean for the current, open, non-removed Session. It does not introduce a compatibility shim, copy Session data, patch Core, substitute model selection, or alter quota requests. The exact official alpha.1/alpha.2 contract is `SnapshotSelectorHook<T>` in `packages/client/store/src/contract.ts`, with the `bindSnapshotSelector` implementation in `packages/client/ui-renderer/src/client/bind.ts`. Model projection remains the public `useProjection('modelSelection')` reader, whose key-only overload is supported.

Validation must include positive rendering with actual selector-hook behavior for both canonical and managed Copilot routes, reactive provider/Session changes and disposal. A null/hidden signed-out surface alone is insufficient. Synthetic quota results prove rendering and lifecycle only, not live account permissions or balances. Current-runtime activation must be checked separately after an explicitly authorized upgrade; reloading alpha.32 does not fix its source call.

## Responsive statistics presentation (alpha.35)

The unavailable Session credits section is omitted rather than permanently displaying a placeholder. Reset metadata is optional and independent from validated quota amounts: missing, malformed, zero or elapsed values are ignored. Select a supplier-reported next reset later than the snapshot observation, preferring the snapshot timestamp before valid UTC account, account or limited-user dates; never invent the next billing date. Invalid optional date metadata does not discard otherwise valid account amounts. The Client also hides reset rows without a known observation time or a later reset.

The compact control uses the native secondary font-size and line-height tokens, tertiary text color and pill padding. It stays one line within its allocated width, with ellipsis and a full-label tooltip if a single reading is wider than the available space. The complete reading remains its accessible button text; exact supplied amounts and account-wide scope remain available in the independent details dialog. Loading and unavailable text use the same bounds without extra quota requests.

The host owns placement of the existing public dock entries. On a shared-row host, the usage entry follows the native statistics group and can appear immediately after Cache hit; on an older stacked host, it retains that host's placement. The plugin neither relocates native DOM nor overrides native statistics styles, and it does not require a modified Core to activate. A separately authorized Desktop Client layout task owns wrapping and actual assembled native-statistics geometry checks.

Official `0.1.6-alpha.2` already provides the shared dock row in [`InputBar.module.css`](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css) and an intrinsic native statistics group in [`StatsPills.module.css`](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/client/ui-chat/src/client/chat/StatsPills.module.css). Reuse that official presentation primitive rather than inventing another statistics Slot or copying its token calculations. Wide/narrow layout and popup acceptance must use actual native components alongside the released Client; standalone plugin tests or a synthetic sibling label are not proof of native Cache hit alignment.

## Official-first retirement

Retain this bounded companion feature only while native DSH lacks equivalent public account-usage presentation for the required scope. Migrate to native functionality once equivalent data semantics, account invalidation, session attribution, accessible presentation and supported-version acceptance are verified. Do not require a Core patch or add a parallel model transport to complete this integration.
