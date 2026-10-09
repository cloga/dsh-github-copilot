# Oversized compaction recovery

Tracking: [#228](https://github.com/cloga/dsh-github-copilot/issues/228), [#330](https://github.com/cloga/dsh-github-copilot/issues/330). Target: unchanged official DSH `0.2.0-rc.2` (`639ed015397290b3745d163aafe02ffee4aa3f84`). This document specifies a **separately selected** Host compaction engine; installing this plugin by itself does not replace a running Core engine. Once selected, automatic segmented recovery defaults on. The historical package export and class name remain compatible.

## Requirements and failure boundary

An already oversized, compressible manual summary must be able to make progress without submitting the same over-budget prompt again. The motivating detached session had a roughly 508k estimated summary input versus a roughly 368k hard input budget with 65,536 reserved output tokens. The independent model prompt ceiling, not the output reservation alone, binds. The native one-shot summarizer sends the entire selected balanced span plus a directive, and the managed-route guard correctly refuses that input. The prior Auto meter repair prevents incorrect candidate selection; it does not shorten this summary.

Recovery must leave the original Session surface intact until a smaller *complete* checkpoint has been accepted by Core's native transaction. It must retain the system head, tool declarations and chronological content, never split a tool-call/result pair, honor cancellation and source changes, bound all provider calls, and preserve the actual summary route and output cap. If a fixed head or one indivisible unit cannot fit, an intermediate summary is truncated/empty, account proof expires, the history changes, or the call limit is exhausted, fail with a named diagnostic and no replacement. No live inference, credential changes, automatic model switch, history deletion or summary-success claim follows from a local test.

## Composition and algorithm

`CopilotManualRecoveryCompactionEngine` is an opt-in alternative to **one** official `BasicCompactionEngine` registration. Operators selecting it must replace (not mount alongside) their existing basic compaction service in the same Host scope; the default plugin registration never changes the service. It subclasses the published engine: Core still owns automatic triggering/retries, manual idle maintenance, a single bracketed durable transaction, balanced range selection, checkpoint framing, source-stability/shrink checks, cancellation, failure classification, flush, and optional native pruning. With an authenticated, current managed Copilot summary model, the same hook handles manual and automatic summaries. All other providers delegate unchanged. A pending model picker is not summary-route evidence: an explicit native summary target wins, then the latest committed header, then Agent options.

`automaticRecovery` defaults to `true` in this engine's config. Set it to `false` to retain stock automatic single-summary behavior while keeping manual segmented recovery. Native `auto: false`, `maxOverflowRetries`, thresholds and model policies retain their meaning; no background command or second transaction is launched by automatic recovery. A fitting summary first uses the unchanged native single call. A known oversized input directly enters segmented recovery. Only an actual native `LlmError` with `CONTEXT_WINDOW_EXCEEDED` from that first single summary permits one fallback. Its planning bound halves the partitionable history while retaining the fixed system head/tools and enough space for the largest balanced unit, never exceeding the original bound. If that requires the entire rejected input, fail as indivisible instead of resubmitting it unchanged. A segment failure is never recursively retried. HTTP 408, timeout, auth, quota, network, cancellation, empty or truncated output do not authorize fallback.

The plugin's account service supplies a current descriptor and a revocable proof for the explicit initiating Agent, not another Session or today's global account. Each physical summary uses public initiator scoping; no credential discovery or Client credential reads are added. Account/selection changes revoke the proof. The summary budget uses `min(maxInputTokens, contextWindow - configuredOutputCap) - safetyTokens`; an additional 4096-token allowance covers Core's appended directive and estimation variance, and actual tool-history bytes are reserved separately. Each candidate is planned using conservative serialized UTF-8 **model-content bytes**: role/content, tool-result call ID/error state, tool schemas, the system head and prior intermediate checkpoint. Native message IDs, source/provenance and opaque replay envelopes are not serialized or charged by this planner. They previously inflated segment counts despite not being ordinary prompt content, causing otherwise compressible histories to exhaust 16 calls.

This is not provider-exact token accounting or a complete wire-size bound. The original messages, sources and replay are still passed unchanged to the published adapter; existing consent alone controls outgoing replay filtering. The final native managed-route guard prices converted replay, images and the complete request and remains authoritative. A segment that still exceeds that guard fails; it is never recursively retried or rewritten. Excluding metadata from planning neither bypasses admission nor authorizes additional loss.

The hook partitions the *original* span only at balanced boundaries, summarizes each part through `super.summarize`, and supplies the previous completed intermediate checkpoint as context for the next call. Thus the last completed summary contains all processed parts in chronological order. The engine allows at most 16 physical summary calls per hook invocation, including any initial capacity failure (the exported helper's hard maximum remains 32). Each carries the native cancellation signal and checks account proof before and after dispatch. The original surface is not modified between calls. Core checks for a smaller replacement and current source after the final result; any failure closes the native marker without a partial summary replacement. Native pruning that already committed remains Core-owned. Native automatic retry/rebuild resumes the task only after a valid durable reduction.

Segmented recovery can take longer and incur additional provider charges. A sanitized Host log announces entry and its call bound; the Client keeps native compaction progress and cancellation, not a fabricated per-segment progress bar. The native transaction result remains the success evidence.

## Background command for Desktop

With this engine selected and the public `commands` and `jobs` services available in its scope, use:

```text
/copilot-compact
/copilot-compact status
/copilot-compact cancel
/copilot-compact visible-history
```

The jobs package is a development-only type dependency: the plugin imports no jobs runtime implementation, and the engine's public declaration does not expose its types. Runtime access is through the optionally injected Host service; no jobs package is bundled, installed as a new peer, or registered by this plugin.

The first command acknowledges **job admission**, not a completed summary. The existing native `/compact` command remains unchanged. Desktop rc.2 forwards unary command requests through Node `fetch`; a long synchronous compact can exceed the default 300-second response-header wait and lose its caller connection. The background command returns promptly and transfers work to a Session-owned native job with its own cancellation controller. A later HTTP disconnect does not cancel admitted work.

Status and cancellation apply only to the invoking Agent's latest job. Duplicate starts return the current running job rather than starting another transaction. The selected engine still acquires Core's maintenance lock and owns the only native transaction; another active turn or compaction can cause the admitted job to fail. Job status distinguishes running, completed, failed and cancelled work. Failure details are sanitized; consult the native compaction/end record for the underlying summary/transaction diagnostic. Provider timeout, truncation, capacity and account-proof failures remain failures.

### Explicit visible-history summary recovery

For a verified `COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH`, repeating the same summary cannot repair supplier-scoped encrypted replay. The existing **Visible-history continuation** Session policy now authorizes managed Responses summaries as well as chat: ordinary `/compact`, `/copilot-compact` and automatic compaction apply it before dispatch, without a failure-first retry or extra command. The active turn retains its captured persistent policy; idle summaries capture the Session policy. Disabled/unknown policy never silently enables loss, and legacy next-turn-only consent does not authorize summaries. Stock and selected recovery engines remain independently owned. An additive composer notice reports filtering and distinguishes native commit, failure and cancellation; exact scope rejection when off offers the same persistent enable control. This is not a capacity/timeout/quota cure or permission to enable an absent engine.

For an existing open Session on the managed account-discovered Copilot route,
the persistent control is in the composer **Credits/usage** popover: expand
**Visible-history continuation**, review the loss disclosure, then choose
**On** under **Session policy**. The control is not shown for the
canonical/native route. Enabling applies to subsequent turns and summaries in
that Session even when the account does not change; an already admitted turn
keeps its captured policy. The **New Session continuation default** in Models
is separate and only determines inheritance for eligible new Sessions. See
[the synthetic composer capture](./images/copilot-session-continuation.png) and
[Session continuation](./session-continuation.md) for the complete admission,
scope and persistence contract.

`/copilot-compact visible-history` remains explicit consent for **one lossy manual compaction operation** through the selected engine, without changing the persistent checkbox. Managed Responses summary requests omit historical encrypted reasoning items **and their embedded summaries**, while retaining visible messages, tool calls/results, the system head and native final directive. Hidden reasoning may contain details absent from visible messages. Review this loss before enabling the policy or issuing the one-time command.

Consent is local to the native summarizer's exact cancellation signal, Session and summary model, including its bounded segments. It is revoked on completion, failure, cancellation or teardown. No unrelated request, subsequent command or automatic retry inherits it. Unknown or incomplete reasoning fails closed. No replay is decrypted, fabricated or written back; original source events remain unchanged and only Core can commit the final smaller checkpoint. The command adds no retry or model/account switch, and does not repair supplier scope. Missing managed integration or an unsupported summary route fails explicitly.

The conservative content estimate still includes visible native history before outgoing filtering, but not source/replay metadata. Giant indivisible units, fixed prefixes, native admission, bounded-work/call limits, truncation and failure to shrink can still prevent recovery. This command is not guaranteed to rescue every history, and summary calls may incur charges. Installation alone neither selects the engine nor runs this command.

The visible-history composer notice keeps running loss disclosure visible. A confirmed native completion is shown for a fixed eight seconds from the first current Client read, not from a rerender or later read. Success may also be closed early; failed/cancelled/unavailable and blocked enable prompts never auto-expire and have a localized, keyboard-accessible **Close**. The existing blocked prompt **Cancel** also hides only the notice. Neither action changes persistent consent, invokes recovery, sends/retries, or changes native outcome evidence/history. A dismissal applies only to the exact Session, operation and status, never a later running/failed state. Expiry/dismissal survives incidental remounts and Session switches in a Client registration-owned FIFO of at most 128 records; teardown clears it, and an evicted record may be shown again. No disk or module-global cache is used. Component timers stop on unmount/Session changes; departed reads cannot start a lifetime or publish stale status. This transient presentation is not proof of the subsequent chat request succeeding.

Background status now exposes only allowlisted fixed failure codes through bounded native Error cause chains, including replay-scope rejection; raw exception text, response bodies and history remain excluded. Unknown failures retain `COPILOT_BACKGROUND_COMPACTION_FAILED` with guidance to the native `compaction/end` record. An admission receipt is not success; check status and the native transaction.

The plugin collects the job's native settlement with `jobs.wait`, so the ordinary job reporter does not wake the model or resume its Goal. It never calls followup or inject. Explicit cancellation, owner disposal and plugin/Host teardown cancel and drain the producer. Owner teardown can fail native maintenance before the job receives cancellation; that outcome remains failed rather than being relabeled successful or cancelled. Jobs are process-local: status does not survive a Host restart, and the plugin does not silently restart interrupted work. Durable Core compaction events remain the outcome evidence. Merely installing the main plugin does not select this engine or make this command available; missing commands/jobs services leave the background entry unavailable without changing ordinary compaction.

**Audit:** each physical call goes through Core's public `llm.stream` seam with its actual route/cap. The final native summary event is intentionally *unmarked* (`llmStreamCall` absent), not a fabricated claim of one call. It records summed provider-reported usage only when **every** underlying call supplied usage; optional counters are included only if present on every call. After a failed initial single call, aggregate usage is omitted because this hook cannot recover that call's complete accounting. The native event format has no per-call array or durable per-call transcript in a single summary event; do not infer individual request accounting from that aggregate. This is a real observability limit of the unchanged public contract.

This aggregate is not per-call attribution: it cannot reconstruct which intermediate request used which tokens, identify each physical response, or prove that native call-attribution consumers count every intermediate request. The plugin does not manufacture `llmStreamCall`, response IDs, or individual durable usage records to fill that gap. Reported aggregate provider usage and Core's native call-attribution/accounting are separate evidence layers.

## Native admission and historical usage evidence

The exact rc.2 `llm-pi-ai` public adapter converts both plain and replay-backed historical assistant messages with `emptyPiUsage()` and `timestamp: 0` (`replay.ts`); converted user messages, including new intermediate checkpoints, also have timestamp zero (`context.ts`). Therefore creating a checkpoint **does not** invalidate an old SDK usage anchor through a newer timestamp. On this pin, Core does not carry the historical assistant usage into the SDK context in the first place. Recovery neither clears that usage itself nor changes message timestamps, replay state, native conversion, the SDK estimator or the final managed guard. This behavior must be requalified when the Core/pi-ai pin changes.

The unchanged-Core fixture exercises the real managed adapter and its `inspectRequest` guard with a synthetic 27-turn history whose latest provider-reported input is 508,198 tokens, plus 3.5 KB of synthetic native provenance/replay padding per assistant. The old whole-message planner exhausted exactly 16 calls on this metadata-heavy fixture without replacement. The content planner first proves stock manual compaction fails the 12,000-token input bound without reaching the synthetic wire, then proves the opt-in engine commits one replacement through bounded calls. The captured SDK estimates include the complete native compaction directive, system policy and tool schemas, not a prompt with its final directive removed. Every dispatched estimate fits the hard limit; the 8,192 output cap is preserved, source events remain byte-identical, and every intermediate wire call observes the original surface generation. Estimator instrumentation calls the original SDK utility without altering its result. The fixture verifies zero carried usage anchors, aggregate usage and the deliberately absent single-call marker. Synthetic scaled-down input limits and transport establish native admission/transaction behavior, not provider-exact capacity or live Copilot success.

## Limitations and operational use

This path only helps histories with balanced boundaries and intermediate summaries that fit their model's input and output limits. One giant user/tool result, a huge fixed head/tool schema, an incomplete tool pair, provider truncation, or a final checkpoint that is not smaller remain explicit failures. Intermediate model summaries are lossy in the same sense as ordinary Core compaction; review important context before explicitly invoking manual compaction. The conservative UTF-8 bound may reject a request that a provider could accept. The algorithm does not claim provider-exact token measurement or repair of a damaged/unmatched pre-existing compaction bracket.

Select the exported `dsh-github-copilot/manual-compaction-recovery` Host class **instead of** the stock basic compaction plugin in a reviewed Host composition. For a composition that normally contains `- name: '@deepseek-ai/dsh-compaction-basic'`, remove that single row and use this row in the same scope:

```yaml
- name: 'dsh-github-copilot/manual-compaction-recovery'
  config:
    auto: true
    maxTokens: 65536 # example only: preserve the reviewed original cap
```

Keep the existing BasicCompactionConfig, including any modelPolicies and actual maxTokens; configure a summary route deliberately if the last committed model cannot serve the summary. Do not enable two compaction services or modify a live profile without explicit approval. The normal plugin and all ordinary sessions remain usable without this replacement; the package export alone neither installs it nor changes an existing Session.

### Explicit configuration migration

1. With separately approved profile maintenance, inspect the effective Host composition and the initiating Agent's bound preset. Identify exactly one stock basic engine in the intended scope; an absent or custom engine is not a migration target.
2. In the owning configuration, replace only that row's `name` with `dsh-github-copilot/manual-compaction-recovery`. Preserve its id, group, isolation, disabled state and full config, including `auto: false`, retention, caps, retry limits and exact model policies. Keep the native compact command and tool-result pruner. Do not add a second row.
3. For a native preset, edit its owned `config.plugins` entry in the native preset editor, preserving the surrounding plugins. Do not replace the whole preset with a stock template. A global engine replacement does not change engines isolated in presets.
4. Review the resulting diff and reload only through approved normal Host/preset maintenance. Existing Agents may retain the older preset generation; verify their actual bound service rather than assuming a setting change moved them. Set `automaticRecovery: false` on the replacement to disable only automatic segmentation.
5. To roll back, restore that row's stock name and remove only the plugin-owned `automaticRecovery` key. Keep the original native config. Already committed native summaries are not reversed.

Do not try to change an existing plugin name with the bundle include patch's `name` field: on rc.2 it is a matching guard, not a replacement. Include patches also do not traverse arbitrary preset `config.plugins`. This release intentionally supplies no automatic live migration, full-preset overwrite, service interception or Core patch. Native isolated-preset fixtures verify the selected replacement, unchanged native config and the disabled/absent/no-retry cases; they are not live deployment receipts.

## Acceptance and retirement

Focused tests must exercise oversized balanced histories, native durable replacement and no replacement on cancellation, truncation, stale source or proof, irreducible units and bounded-call exhaustion. Verify the exact published Core source fixture, frozen install, full plugin gate and immutable package smoke before describing a deployable release. CI with synthetic transport proves no live Copilot availability. Retire this companion path only when official compaction safely handles independent prompt ceilings and multi-call/manual recovery with equivalent durable audit, lifecycle and transaction guarantees.
