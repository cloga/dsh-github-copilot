# Oversized manual compaction recovery

Tracking: [#228](https://github.com/cloga/dsh-github-copilot/issues/228). Target: unchanged official DSH `0.2.0-rc.2` (`639ed015397290b3745d163aafe02ffee4aa3f84`). This document specifies a **separately selected** Host compaction engine; installing this plugin by itself does not replace a running Core engine.

## Requirements and failure boundary

An already oversized, compressible manual summary must be able to make progress without submitting the same over-budget prompt again. The motivating detached session had a roughly 508k estimated summary input versus a roughly 368k hard input budget with 65,536 reserved output tokens. The independent model prompt ceiling, not the output reservation alone, binds. The native one-shot summarizer sends the entire selected balanced span plus a directive, and the managed-route guard correctly refuses that input. The prior Auto meter repair prevents incorrect candidate selection; it does not shorten this summary.

Recovery must leave the original Session surface intact until a smaller *complete* checkpoint has been accepted by Core's native transaction. It must retain the system head, tool declarations and chronological content, never split a tool-call/result pair, honor cancellation and source changes, bound all provider calls, and preserve the actual summary route and output cap. If a fixed head or one indivisible unit cannot fit, an intermediate summary is truncated/empty, account proof expires, the history changes, or the call limit is exhausted, fail with a named diagnostic and no replacement. No live inference, credential changes, automatic model switch, history deletion or summary-success claim follows from a local test.

## Composition and algorithm

`CopilotManualRecoveryCompactionEngine` is an opt-in alternative to **one** official `BasicCompactionEngine` registration. Operators selecting it must replace (not mount alongside) their existing basic compaction service in the same Host scope; the default plugin registration never changes the service. It subclasses the published engine and calls `super.compactNow`: Core still owns idle maintenance, a single bracketed durable transaction, balanced range selection, checkpoint framing, source-stability/shrink checks, cancellation, failure classification, flush, and optional native pruning. The subclass hook runs recovery **only** inside an explicit manual call with an authenticated, current managed Copilot summary model. Automatic compaction and all other providers delegate to the stock hook unchanged. A pending model picker is not summary-route evidence: an explicit native summary target wins, then the latest committed header, then Agent options.

The plugin's account service supplies a current descriptor and a revocable proof without starting discovery or reading credentials into the Client. The summary budget uses `min(maxInputTokens, contextWindow - configuredOutputCap) - safetyTokens`; an additional 4096-token allowance covers Core's appended directive and estimation variance. Each candidate request is conservatively bounded by serialized UTF-8 size including system, tools, prior intermediate checkpoint and current messages. Native managed-route admission remains the final authority. A call that still exceeds that guard fails; it is never retried with a hidden wire rewrite.

The hook partitions the *original* span only at balanced boundaries, summarizes each part through `super.summarize`, and supplies the previous completed intermediate checkpoint as context for the next call. Thus the last completed summary contains all processed parts in chronological order. Default maximum: 16 calls (hard maximum 32); each carries the native cancellation signal and checks account proof before and after dispatch. The original surface is not modified between calls. Core checks for a smaller replacement and current source after the final result; any failure closes the native marker without a replacement. Only an explicit manual command starts this process.

## Background command for Desktop

With this engine selected and the public `commands` and `jobs` services available in its scope, use:

```text
/copilot-compact
/copilot-compact status
/copilot-compact cancel
```

The first command acknowledges **job admission**, not a completed summary. The existing native `/compact` command remains unchanged. Desktop rc.2 forwards unary command requests through Node `fetch`; a long synchronous compact can exceed the default 300-second response-header wait and lose its caller connection. The background command returns promptly and transfers work to a Session-owned native job with its own cancellation controller. A later HTTP disconnect does not cancel admitted work.

Status and cancellation apply only to the invoking Agent's latest job. Duplicate starts return the current running job rather than starting another transaction. The selected engine still acquires Core's maintenance lock and owns the only native transaction; another active turn or compaction can cause the admitted job to fail. Job status distinguishes running, completed, failed and cancelled work. Failure details are sanitized; consult the native compaction/end record for the underlying summary/transaction diagnostic. Provider timeout, truncation, capacity and account-proof failures remain failures.

The plugin collects the job's native settlement with `jobs.wait`, so the ordinary job reporter does not wake the model or resume its Goal. It never calls followup or inject. Explicit cancellation, owner disposal and plugin/Host teardown cancel and drain the producer. Jobs are process-local: status does not survive a Host restart, and the plugin does not silently restart interrupted work. Durable Core compaction events remain the outcome evidence. Merely installing the main plugin does not select this engine or make this command available; missing commands/jobs services leave the background entry unavailable without changing ordinary compaction.

**Audit:** each physical call goes through Core's public `llm.stream` seam with its actual route/cap. The final native summary event is intentionally *unmarked* (`llmStreamCall` absent), not a fabricated claim of one call. It records summed provider-reported usage only when **every** underlying call supplied usage; optional counters are included only if present on every call. The native event format has no per-call array or durable per-call transcript in a single summary event; do not infer individual request accounting from that aggregate. This is a real observability limit of the unchanged public contract.

This aggregate is not per-call attribution: it cannot reconstruct which intermediate request used which tokens, identify each physical response, or prove that native call-attribution consumers count every intermediate request. The plugin does not manufacture `llmStreamCall`, response IDs, or individual durable usage records to fill that gap. Reported aggregate provider usage and Core's native call-attribution/accounting are separate evidence layers.

## Native admission and historical usage evidence

The exact rc.2 `llm-pi-ai` public adapter converts both plain and replay-backed historical assistant messages with `emptyPiUsage()` and `timestamp: 0` (`replay.ts`); converted user messages, including new intermediate checkpoints, also have timestamp zero (`context.ts`). Therefore creating a checkpoint **does not** invalidate an old SDK usage anchor through a newer timestamp. On this pin, Core does not carry the historical assistant usage into the SDK context in the first place. Recovery neither clears that usage itself nor changes message timestamps, replay state, native conversion, the SDK estimator or the final managed guard. This behavior must be requalified when the Core/pi-ai pin changes.

The unchanged-Core fixture exercises the real managed adapter and its `inspectRequest` guard with a synthetic 27-turn history whose latest provider-reported input is 508,198 tokens. It first proves stock manual compaction fails the 12,000-token input bound without reaching the synthetic wire, then proves the opt-in engine commits one replacement through bounded calls. The captured SDK estimates include the complete native compaction directive, system policy and tool schemas, not a prompt with its final directive removed. Every dispatched estimate fits the hard limit; the 8,192 output cap is preserved, source events remain byte-identical, and every intermediate wire call observes the original surface generation. Estimator instrumentation calls the original SDK utility without altering its result. The fixture verifies zero carried usage anchors, aggregate usage and the deliberately absent single-call marker. Synthetic scaled-down input limits and transport establish native admission/transaction behavior, not provider-exact capacity or live Copilot success.

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

## Acceptance and retirement

Focused tests must exercise oversized balanced histories, native durable replacement and no replacement on cancellation, truncation, stale source or proof, irreducible units and bounded-call exhaustion. Verify the exact published Core source fixture, frozen install, full plugin gate and immutable package smoke before describing a deployable release. CI with synthetic transport proves no live Copilot availability. Retire this companion path only when official compaction safely handles independent prompt ceilings and multi-call/manual recovery with equivalent durable audit, lifecycle and transaction guarantees.
