# Copilot account usage

The optional composer control separates three quantities:

| Quantity | Scope | Rule |
| --- | --- | --- |
| Context occupancy | Current native request/context window | Remains owned by DSH's native meter. |
| Account usage and remaining allocation | GitHub account billing cycle, across Copilot applications | Display only validated provider quota data; identify stale snapshots explicitly. |
| Session credits | Complete provider-reported usage attributable to this DSH Session | Unavailable in this version. Do not infer it from tokens, cost estimates or account balance changes. |

## Presentation

The control is an additive `conversation.composer.dock` contribution for the current Copilot Session. It does not replace the composer, move native DOM nodes, modify global defaults, switch a model or enroll other Sessions. Native context occupancy and the new account budget are not interchangeable.

The compact control shows reported usage and remaining allocation where available. Its details explain the unit, budget, reset timestamp, freshness and unavailable data. Legacy premium requests must never be relabeled AI credits. A pooled organization account can have absolute credits used without a personal denominator; it does not imply unlimited use or expose a knowable organization balance. Percentage-only data must not create falsely precise absolute amounts.

Detailed amounts are rounded to two decimal places for display; a positive amount below 0.01 is shown as `<0.01`, not zero. GitHub billing remains authoritative. Known individual budgets at 90% used show a low-budget warning, not a spending restriction. The plan link uses the supported Desktop browser handoff with a selectable URL fallback. Details use the browser's native popover top layer when available and a fixed-position fallback otherwise; no additional ReactDOM copy or private Core DOM access is introduced.

Provider or Session changes, unmounting and missing supported runtime seams revoke the presentation's ownership. Optional capability failure must not disable sign-in, Models, search or ordinary chat. The installed/loaded Client determines the exact dock placement; the standalone design mockup is not proof of native placement.

## Account data boundary

The Host uses the existing `llm-pi-ai/github-copilot` OAuth grant through public credential APIs. GitHub's `copilot_internal/user` endpoint uses the GitHub grant, not a second sign-in or a newly pasted token. Access-token renewal remains owned by pi-ai; quota inspection must not introduce a refresh implementation or credential persistence.

Quota requests are lazy, single-flight and bounded by timeout, response size and cache/failure policy. Account continuity is checked around asynchronous work and before releasing cached data. Authentication denial, sign-out, account invalidation or disposal must not release a previous account's snapshot. A same-account transient failure may expose a timestamped last-known snapshot, never a current balance. Responses and diagnostics exclude tokens, raw provider bodies and account identifiers. Requests do not follow redirects with the credential; custom enterprise hosts are not guessed.

The Client receives only the separate strict `githubCopilotUsage` namespace (`get` and `refresh`). Existing authorization and migration methods retain their schemas. Refresh does not change settings, budget, plan, model selection or billing policy. This meter is informational and does not authorize spending or implement a budget enforcement loop.

## Source contracts and limitations

GitHub's internal client endpoint is not a stable public third-party REST contract. The existing grant may not be permitted to read it, and its schema may change. Failure must remain visible rather than falling back to an administrator token, another account, a browser token or fabricated numbers.

Verified reference sources:

- [Official VS Code account snapshot types](https://github.com/microsoft/vscode/blob/44825207bf4389c3bd17c92d3ec28cf784c324cc/src/vs/base/common/defaultAccount.ts).
- [Official quota normalization and pooled-account semantics](https://github.com/microsoft/vscode/blob/44825207bf4389c3bd17c92d3ec28cf784c324cc/src/vs/workbench/services/chat/common/chatEntitlementService.ts).
- [Official quota fetch and per-turn credit accounting](https://github.com/microsoft/vscode/blob/44825207bf4389c3bd17c92d3ec28cf784c324cc/extensions/copilot/src/platform/chat/common/chatQuotaServiceImpl.ts).
- [GitHub's public organization/enterprise usage reporting API](https://docs.github.com/en/rest/copilot/copilot-usage-metrics) and [report fields](https://docs.github.com/en/copilot/reference/copilot-usage-metrics/copilot-usage-metrics). Daily administrator reports are not a live personal balance API.
- [GitHub's explanation of used credits with no individual budget](https://github.blog/changelog/2026-07-20-copilot-users-can-now-see-ai-credits-used-per-billing-cycle/).

The internal client observes per-turn `copilot_usage.total_nano_aiu`, but existence in another client's wire response is not evidence that the supported DSH/pi adapter exposes complete session accounting to plugins. On the exact alpha.2 source, [`mapUsage`](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm-pi-ai/src/stream.ts) maps only token counts and cache counts into the public [`StreamChunk` usage contract](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm/src/types.ts). Opaque replay state is not an accounting escape hatch. Until an unchanged public seam provides attributable, deduplicated receipts for ordinary calls, retries and background activity, **This session** remains unavailable.

Synthetic tests cover parsing, lifecycle, failure states, strict transport and UI. They do not establish production quota permissions, billing latency, live OAuth/model transport, installed Desktop bytes or loaded plugin state. No real account calls are made merely to generate test evidence.

## Official-first retirement

Retain this bounded companion feature only while native DSH lacks equivalent public account-usage presentation for the required scope. Migrate to native functionality once equivalent data semantics, account invalidation, session attribution, accessible presentation and supported-version acceptance are verified. Do not require a Core patch or add a parallel model transport to complete this integration.
