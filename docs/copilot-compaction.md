# Managed Copilot compaction budgets

Tracking: [#146](https://github.com/cloga/dsh-github-copilot/issues/146). This is a plugin-only implementation; publication, loaded-runtime state and live-provider acceptance remain separate evidence.

## Why two protections are needed

The motivating session recorded both `summarization truncated at the token cap (incomplete checkpoint)` and later HTTP 400 input-context overflow in automatic/manual compaction. A successful summary after an explicit model change used 7575 output tokens under an 8192-token cap. These observations do not establish hidden reasoning consumption, either model's contemporaneous capacity, or that simply changing the cap solves the problem.

The managed account catalog already retains three different facts: combined context capacity C, independent prompt ceiling I when supplied, and output capability O. Previously I produced a warning only. Stock Core exposes C and triggers normal pressure relative to C; that does not independently enforce I.

## Budget admission

`request-budget.ts` resolves validated operational policy without mutating catalog metadata:

```text
R = explicit requested output cap, otherwise advertised output capability O
hard input limit = min(I when supplied, C - R) - safetyTokens
pressure input limit = floor(hard input limit * pressureRatio)
```

An independent input ceiling does not include output, so output is subtracted from C, not twice from I. Missing I does not mean unlimited combined context. If catalog context was conservatively derived from prompt-only metadata, it retains that existing interpretation; the plugin does not invent an unadvertised larger combined capacity.

Invalid/nonpositive model capacities, invalid output caps, caps above O and nonpositive headroom fail explicitly. Impossible policy headroom is `INVALID_REQUEST`, not a request to compact an arbitrarily small history. An input estimate above a valid budget becomes `CONTEXT_WINDOW_EXCEEDED` with a plugin-owned, numeric diagnostic. This is a local estimated admission decision, not a fabricated provider rejection.

Final admission happens at the native provider boundary after Core conversion, before model transport. It uses the larger of native usage-anchored estimation and fresh current system/tool/message estimation, so a tiny historical usage anchor cannot hide a newly enlarged fixed prefix. Images and opaque native replay retain native representation and estimation; neither is decrypted, reconstructed or discarded. Token estimation is heuristic, not the provider's exact tokenizer. Safety allowance and genuine provider failure handling remain necessary.

The pinned SDK already has its own context-dependent output clamp. This plugin preserves the caller's requested cap rather than introducing another hidden rewrite. No second generic serializer, account-model table, credential lifecycle or native protocol transport is added.

## Earlier pressure and transaction ownership

The public `llm/stream` listener sees a committed, frozen loop request. It requires:

- The exact plugin-owned managed route and an ordinary marked agent-loop call, not an auxiliary purpose.
- The public initiating Agent, matching Session ID, and complete matching committed call configuration.
- Current account-bound descriptor/proof and a valid operational budget.
- Optional token meter and stock automatic compaction with a positive effective overflow-retry policy.

Only then does it emit one terminal local pressure error before dispatch. Official `agent/request-error` recovery owns pruning, balanced-span selection, compaction locks, source checks, durable shrink and bounded retry. The next request is rebuilt from the replaced surface. The plugin never compacts inside a frozen request then sends the stale request, changes the retry counter, or registers a competing compaction service.

Disabled auto recovery or zero retries are respected. Missing/mismatching optional capabilities delegate unchanged and can produce one bounded unavailability diagnostic; the hard native guard remains. Cancellation before iteration wins over pressure. There is no polling, automatic metadata refresh from the pressure listener, or whole-Session dump.

## Summary purpose policy

Official `GenerateOptions.purpose` permits adapter-specific generation policy. For `purpose: 'compaction'`, `prefer-low` selects supported `minimal`, otherwise supported `low`, only when no effort was supplied or materialized by Core/the configured native profile. Explicit and resolved defaults win; unsupported low controls preserve the provider default. `preserve` disables this purpose default. Normal conversations and other purposes keep their existing reasoning behavior.

The stock summary record takes its requested output cap from the owning compaction configuration. Therefore the plugin does not silently increase/decrease that cap in middleware or alter summary route identity. It preserves native `max-tokens` output truncation as failure, distinct from input overflow. Public summaries, encrypted replay and native stop reasons remain native-owned.

Each dispatch captures its own policy, descriptor lease and admission-failure state. SDK lazy-stream wrapping may retain only an exception's text; the outer adapter restores only the exact locally captured budget failure, never reclassifying unrelated auth/network errors by guesswork. Concurrent calls do not share mutable purpose or failure state, and cancellation/account invalidation still wins.

## Settings

All three keys belong to the existing `github-copilot` settings namespace:

| Key | Default | Contract |
| --- | --- | --- |
| `requestBudgetSafetyTokens` | 4096 | Non-negative safe integer; more allowance means less usable input. Lowering it trades away preventive headroom and does not change native SDK safeguards. |
| `requestBudgetPressureRatio` | 0.9 | 0.01 through 1, step 0.01, for eligible ordinary loop calls only. |
| `compactionReasoning` | `prefer-low` | Supported low-cost default for otherwise unspecified summary effort; `preserve` keeps existing defaults. |

The existing `enabled` switch remains hosted-search-only. These controls do not change global/default model selection, enable another account route, or transfer conversation data to another provider.

## Existing oversized history and recovery limits

This implementation is preventive, not a general rescue summarizer. A manual summary whose full input already exceeds the hard budget fails before model transport. It does not silently trim, fabricate a partial checkpoint, or claim that refusing the request recovered the history. Giant fixed prefixes or an indivisible latest unit can also prevent useful reduction.

Official configuration already supports a separate summary route and output cap. Selecting a suitable authorized route/cap is an explicit deployment choice, not an automatic fallback. Increasing the output cap consumes combined-context headroom; decreasing it can reproduce the observed incomplete-checkpoint failure.

Bounded chunk/merge rescue was evaluated but is not included here. The official BasicCompactionEngine subclass hook is a possible extension, but would require an explicit single-provider composition choice, complete multi-call audit records, bounded calls/output, tool-pairing preservation and transactional cancellation/failure tests. Do not add it through a transparent wire interceptor or label several calls as one auxiliary request. Core changes are not a prerequisite for this preventive release.

## Official-first evidence and retirement

Exact target: official `ddefc45fbc7f8e46dd73185e68295696d1297887` (`0.1.6-alpha.2`).

- [Model context and purpose contract](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm/src/types.ts): combined context metadata and purpose-specific adapter policy.
- [Basic compaction](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/compaction/compaction-basic/src/index.ts): official pressure/overflow/manual paths and summary extension.
- [Summary owner](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/compaction/compaction-basic/src/summarizer.ts): request prefix, purpose, output cap and truncated-output refusal.

Support is partial: official transactional compaction is reused, while independent Copilot input admission and summary-purpose default policy remain companion-owned. Retire the corresponding companion component only after official behavior covers both input/output constraints, correct request identity, cancellation, purpose handling and equivalent regression/unchanged-runtime acceptance. Do not remove official recovery or falsify contextWindow to reduce the diff.

## Verification boundary

Pure arithmetic and policy tests, public-middleware fixtures, and the real published native adapter/SDK with synthetic transport cover separate layers. Required cases include independent/combined bounds, changed prefixes, explicit/default output and effort, metadata/credential invalidation, direct/prepared parity, concurrent calls, cancellation, output truncation and oversized manual input. Existing full plugin gates and exact-Core compatibility fixtures remain required; source inventory is not their execution result.

No live model inference, local Desktop installation, activation or restart is implied by unit tests or publication. Preserve immutable GitHub/npm byte identity and coordinate Desktop/Ops pins separately after release verification.
