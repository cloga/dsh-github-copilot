# Managed Copilot compaction budgets

Visible-history continuation does not impose a whole-request byte cap. Its
reasoning-only cancellable work bounds are separate from native token admission;
neither ciphertext length nor `COPILOT_CONTINUATION_REASONING_WORK_LIMIT` is
classified as context overflow. Enabled native automatic compaction still owns
summary commit and request rebuild before continuation filters the new payload.
See [continuation safety and evidence](./session-continuation.md#public-integration-and-safety).

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

For [#280](https://github.com/cloga/dsh-github-copilot/issues/280), a public `agent/pre-step` listener additionally prevents known continuing-step pressure before Core appends `step/start`. It awaits downstream decisions, delegates rejection/cancellation, and requires a committed plugin-owned managed route, no model-selection notice, and a readable native `modelSelection` projection with `pending: null`. First steps and unknown/pending selections delegate: a prior request header is not proof of the next selected route.

The account callback supplies only a current capacity threshold; an empty message array used for this lookup is not an input estimate. The public native token meter measures the existing surface. Above that threshold, the initiating Agent's currently bound engine runs one `compactIfNeeded(agent, 'context-overflow', signal)` transaction, respecting disabled auto and the effective zero/invalid overflow policy. Native failures and cancellation propagate before model-attempt admission; a null/no-progress result delegates to the retained final protections. The next native request is built from the replacement surface. No retry counter, history, usage sample or selected model is rewritten.

This is **partial prevention**, not general accounting repair. In the unchanged rc.2 synthetic AgentLoop fixture, the existing post-start pressure refusal creates an unsampled attempt and the strict native turn aggregate is unavailable, even after successful recovery. With pre-step reduction, the same two real model steps retain their complete native total without that attempt. Native turn-tail matches events by their recorded turn; compaction replacements for an earlier turn are not samples of the current turn. No samples are suppressed to produce the total.

Cold/first-step routes, pending model changes, later system/tool-prefix growth, unavailable evidence, indivisible oversized units and final converted hard-admission errors can still produce missing native turn Usage. Already-recorded totals remain unchanged. The plugin does not fabricate zero usage, display partial sums as full totals, or reinterpret transport failures as compaction pressure.

The public `llm/stream` listener sees a committed, frozen loop request. It requires:

- The exact plugin-owned managed route and an ordinary marked agent-loop call, not an auxiliary purpose.
- The public initiating Agent, matching Session ID, and complete matching committed call configuration.
- Current account-bound descriptor/proof and a valid operational budget.
- Optional token meter and stock automatic compaction with a positive effective overflow-retry policy.

Only then does it emit one terminal local pressure error before dispatch. Official `agent/request-error` recovery owns pruning, balanced-span selection, compaction locks, source checks, durable shrink and bounded retry. The next request is rebuilt from the replaced surface. The plugin never compacts inside a frozen request then sends the stale request, changes the retry counter, or registers a competing compaction service.

Disabled auto recovery or zero retries are respected. Missing/mismatching optional capabilities delegate unchanged and can produce one bounded unavailability diagnostic; the hard native guard remains. Cancellation before iteration wins over pressure. There is no polling, automatic metadata refresh from the pressure listener, or whole-Session dump.

On official `0.2.0-rc.2`, Desktop presets may isolate `compaction` inside a child group, invisible to both the global plugin context and a plain `agent.ctx.get('compaction')`. The plugin uses the public `agentPresets.composedPreset()` and `serviceFor(agent, 'compaction')` methods to resolve the initiating Agent's current preset engine. A bound preset with no engine remains unavailable; it never borrows another scope's policy. Only an Agent without a bound preset uses its own context lookup. The lookup is repeated rather than caching a replaced engine. Auto's recovery-availability diagnostic uses the same helper.

This fixes scope wiring, not a new automatic command: native pressure and `agent/request-error` still invoke the selected engine. Neither `/compact` nor `/copilot-compact` is called by this listener. If the recovery engine is selected, automatic segmentation defaults on for known oversized summary input or one exact native summary capacity failure, within the same native transaction. `automaticRecovery: false` restores its automatic single-summary path; native `auto: false` and retry bounds remain authoritative. Ordinary timeout/transport failures do not become context overflow.

## Summary purpose policy

Replay-scope rejection is not input overflow: a smaller summary request can still
carry old encrypted reasoning that the supplier refuses. Ordinary and automatic
compaction never inherit chat continuation consent. The selected recovery engine's
explicit `/copilot-compact visible-history` authorizes one lossy Responses summary
operation, with safe failure-code reporting and unchanged native transaction
ownership. Review [consent and bounded limitations](./manual-compaction-recovery.md#explicit-visible-history-summary-recovery)
before invoking. This does not decrypt or repair replay, rewrite source history,
retry a failed message or guarantee capacity recovery.

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
| `responsesRequestCompression` | `false` | Experimental, opt-in lossless gzip for eligible managed HTTP Responses requests; no context reduction or additional retry. |

The existing `enabled` switch remains hosted-search-only. These controls do not change global/default model selection, enable another account route, or transfer conversation data to another provider.

## Existing oversized history and recovery limits

HTTP `408 / user_request_timeout` is separate from input-budget overflow. For the exact observed request-body timeout response, the managed route supplies a safe `COPILOT_REQUEST_BODY_TIMEOUT` diagnostic and final JSON UTF-8 byte count when available, while preserving native failure classification and retries. These bytes include serialized messages, tools and replay/attachments; they are not token occupancy or an advertised HTTP-size limit. Repeated unchanged retries cannot reduce the request. After retries exhaust, an explicit native compaction may reduce compressible history, but giant fixed prefixes/attachments and network/service faults may remain. The existing optional manual recovery engine must be separately selected; installing the account plugin does not enable it. No 408 triggers automatic compaction, hidden history trimming, credential refresh, model switching, timeout changes or a second retry loop. Consult [GitHub troubleshooting](https://docs.github.com/en/copilot/how-tos/troubleshoot-copilot/troubleshoot-common-issues) and [service status](https://www.githubstatus.com/) without bypassing network policy.

`github-copilot.responsesRequestCompression` is a separate, experimental, default-off upload mitigation. Explicit opt-in gzips only account-proven official Copilot HTTPS `/responses` POSTs with a string JSON body, at the existing plugin-owned Fetch seam after native serialization, replay normalization and context admission. Custom Fetch, other APIs, explicit `auto` and WebSocket remain unchanged. It starts at 256 KiB, skips compression work above 32 MiB, and requires at least 5% and 4 KiB savings; every ineligible, oversized or uneconomic body remains the original native request. The asynchronous work is cancellation/account/deadline fenced before dispatch. No route pinning, hidden trimming, token/admission changes, identity resend after 415, retry or model switch is added.

For a verified 408 after a compressed request, the diagnostic labels the original JSON composition bytes separately from the prepared gzip HTTP-body bytes (excluding transport framing). The compressed size is not confirmed delivered bytes, a token count, a provider size limit or proof of a network cause. A skipped compression may include one fixed reason; request bodies and headers are not retained. Synthetic controls support an opt-in mitigation only, not a universal provider capability or guaranteed 408 cure. Keep it off where endpoint support is unknown; disabling it affects later dispatches and installation never enables it.

For [#263](https://github.com/cloga/dsh-github-copilot/issues/263), the same public final-body fetch hook additionally captures a monotonic fetch-invocation-to-response-header duration, before clone observation. This is round-trip latency, not measured upload progress, throughput or time spent reading the body. Only a verified exact error triggers numeric composition analysis; successful requests are not analyzed or retained.

For #291, request-scoped public Node/Undici diagnostic channels also observe local body-write completion and native response-header timing, negotiated TLS ALPN when exposed, and a public Node writable-buffer count at body-write completion. Exactly one matching native request is required; no matching event, multiple requests (such as redirects), and more than eight request identities yield explicit unavailable, ambiguous or work-limited evidence, never combined partial timings. H2 connection evidence does not depend on H1-only header-write events; reused H2 sockets or custom transports may leave ALPN unavailable. Subscriptions stop when Fetch settles, including errors, before bounded response-clone analysis. Only an exact verified timeout emits these numeric observations; no request fields, headers, URLs, content, replay or credentials are retained or logged. The original Fetch arguments, signal, Response/error, dispatcher, proxy, connections and retries remain native-owned.

Local `bodySent` means the client reported body-write completion, **not** measured upload duration, kernel acknowledgement, supplier receipt or model execution. No completion event is not proof that upload was incomplete. A zero Node writable buffer is likewise not proof of remote receipt. This can correlate later real failures without changing their classification, but does not establish a supplier cause or cure recurring 408s; synthetic healthy requests are not live failure acceptance.

Original serialized value spans partition total bytes into `input`/`messages`, tool definitions, protocol-owned top-level `instructions`/`system` and residual keys/framing. Within conversation only, supported structural image blocks and opaque replay string spans form disjoint subsets; the rest includes text/tool history, framing and unknown representations. Completions system/developer messages stay in conversation. Image URLs and file references are counted as wire blocks, not fetched/decoded file sizes. Responses encrypted content and Anthropic signature/redacted data are counted without interpreting or decrypting replay; no raw contents, IDs, hashes or credentials are reported.

Responses tool pictures are also image blocks: the native SDK serializes them under `function_call_output.output[]`, separately from ordinary message `content[]`. Older plugin diagnostics incorrectly classified those spans as remaining history, so an old report of zero image bytes does not establish an image-free request. The corrected diagnostic applies only to newly observed failures; stored failures and history are not rewritten. Unknown output arrays remain residual, and the fix changes neither total bytes nor native image admission, offload budgets, replay or transport.

Analysis accepts at most 16 MiB of UTF-8 JSON, with a pre-parse depth/token bound (64 levels / 131072 tokens), followed by at most 65536 values and 128 serialized key characters. Missing, malformed, unsupported, size-limited and work-limited evidence has a named unavailable state with no partial success-shaped totals. Limits bound diagnostic cost and are **not supplier request limits or admission controls**. A reported 9 MiB body may be analyzed, but its size does not establish why a timeout occurred. If image blocks dominate, an explicitly selected smaller `chatMaxRequestImageBytes` can authorize native image offload; if compressible history dominates, explicit native compaction can help. Tool definitions and opaque replay may remain; small failing requests still warrant network/service investigation. Neither choice is performed automatically or guaranteed to reduce 408 frequency.

This implementation is preventive, not a general rescue summarizer. A manual summary whose full input already exceeds the hard budget fails before model transport. It does not silently trim, fabricate a partial checkpoint, or claim that refusing the request recovered the history. Giant fixed prefixes or an indivisible latest unit can also prevent useful reduction.

The #228 investigation confirmed a separate Auto undercount (#230): Core reasoning blocks caused the incompatible pi-ai estimator to throw and drop complete assistant messages. Auto now uses the native Core meter, without changing final native provider admission. This fixes candidate selection evidence, not a genuinely oversized summary. In the reported failure class, a roughly 508k-token summary input exceeded a roughly 368k-token input budget even with a 65,536-token output reservation. Reducing output reservation cannot remove an independently binding prompt ceiling.

On official `0.2.0-rc.2`, the stock summarizer uses an explicitly configured summary route, otherwise the latest committed request header, otherwise the Agent's initial options. Changing only a pending picker selection therefore does not necessarily change a manual `/compact` request's model. Repeating the same over-budget summary or disabling admission is not a recovery procedure.

Official configuration already supports a separate summary route and output cap. Selecting a suitable authorized route/cap is an explicit deployment choice, not an automatic fallback. Increasing the output cap consumes combined-context headroom; decreasing it can reproduce the observed incomplete-checkpoint failure.

A separately selected recovery engine for compressible already-oversized manual and automatic summaries is specified in [compaction recovery](./manual-compaction-recovery.md). The stock Basic engine and preventive request guard remain unchanged. Selection requires explicit same-scope configuration migration, not installation alone. The selected engine bounds segmentation to 16 physical calls including an initial capacity failure; no hidden wire interceptor, arbitrary-error fallback or recursive retry is used. The native summary event is unmarked when several real calls contributed to one checkpoint.

## Official-first evidence and retirement

Exact target: official `ddefc45fbc7f8e46dd73185e68295696d1297887` (`0.1.6-alpha.2`).

- [Model context and purpose contract](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm/src/types.ts): combined context metadata and purpose-specific adapter policy.
- [Basic compaction](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/compaction/compaction-basic/src/index.ts): official pressure/overflow/manual paths and summary extension.
- [Summary owner](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/compaction/compaction-basic/src/summarizer.ts): request prefix, purpose, output cap and truncated-output refusal.

Support is partial: official transactional compaction is reused, while independent Copilot input admission and summary-purpose default policy remain companion-owned. Retire the corresponding companion component only after official behavior covers both input/output constraints, correct request identity, cancellation, purpose handling and equivalent regression/unchanged-runtime acceptance. Do not remove official recovery or falsify contextWindow to reduce the diff.

Current scoped-recovery evidence additionally targets unchanged official `639ed015397290b3745d163aafe02ffee4aa3f84` (`0.2.0-rc.2`): [public Agent preset service lookup](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/preset/agent-preset-registry/src/index.ts). Native service lookup is complete and reused; plugin pressure still needs the account input budget. Retire this helper when the official request-budget path supplies equivalent preset-owned admission and recovery evidence.

## Verification boundary

Managed HTTP/SSE liveness is separate from compaction and HTTP 408. Core's idle watchdog measures translated assistant chunks, not heartbeat bytes. The plugin observes actual nonempty bytes without parsing or fabricating output: the default byte-idle limit stays five minutes, while native semantic silence is bounded to ten minutes. Consumer think time does not count; endless heartbeats still fail. Caller cancellation and native retry ownership remain unchanged. Explicit WebSocket/auto transport and `chatStreamLiveness: false` retain native-only timing.

`github-copilot.chatMaxRequestImageBytes` exposes the existing native image projection budget with its unchanged 20971520-byte default. An explicit smaller budget can reduce outgoing image payloads by offloading older images into mapped read-only paths; original history is retained, but outgoing image visibility changes. This is not a total request cap, automatic compaction, or a supplier size limit. No live budget reduction is performed by installation or by a 408. Fixed text/tool prefixes and network/service faults may still cause upload timeouts.

Pure arithmetic and policy tests, public-middleware fixtures, and the real published native adapter/SDK with synthetic transport cover separate layers. Required cases include independent/combined bounds, changed prefixes, explicit/default output and effort, metadata/credential invalidation, direct/prepared parity, concurrent calls, cancellation, output truncation and oversized manual input. Existing full plugin gates and exact-Core compatibility fixtures remain required; source inventory is not their execution result.

No live model inference, local Desktop installation, activation or restart is implied by unit tests or publication. Preserve immutable GitHub/npm byte identity and coordinate Desktop/Ops pins separately after release verification.
