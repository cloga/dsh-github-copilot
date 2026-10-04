# Contextual Auto routing and captured selection reasons

Tracking: [#258](https://github.com/cloga/dsh-github-copilot/issues/258) and
[evidence refinement #262](https://github.com/cloga/dsh-github-copilot/issues/262).

**Current contract:** source candidate `0.4.0-alpha.99`, targeting official DSH/Windows
Desktop `0.2.0-rc.2`. Semantic assessment is enabled by default with bounded
auxiliary timing/output evidence. Neither publication nor
these explanations prove the version loaded in a particular Host.

## Using Auto

Choose **Auto · Balance**, **Auto · Efficiency**, or **Auto · Intelligence**
under the managed **GitHub Copilot** provider in DSH's ordinary picker. This is
the plugin's DSH routing policy, not Copilot App's Auto or GitHub's private
router. Selecting a real model exits Auto. Every step/retry in an admitted
turn keeps its chosen model; the next turn can choose differently.

Semantic assessment is already enabled for locally unknown tasks. To opt out,
set `autoSemanticAssessment: false` in the plugin's `github-copilot` settings
namespace; it is not an extra switch on the Web search card. This changes
subsequent assessments, not an already-admitted turn. Local known-task rules
still work when auxiliary inference is disabled.

Open the reply's selection explanation for the captured decision. Evidence is
Host-lifetime and bounded; after restart or eviction it can be unavailable.
Do not infer an old decision from the current picker.

| Reading | Meaning |
|---|---|
| `uncertain` / unknown demand | The available evidence does not establish task demand; it is not a failed answer or a claim that the conversation is empty. |
| `insufficient-evidence` | A local rule or classifier could not justify a demand category. Longer context alone does not guarantee classification. |
| Semantic timeout | No validated result within the 8-second end-to-end budget. Demand remains unknown; Efficiency/Balance target Versatile, Intelligence targets Powerful, subject to eligibility and category fallback. |
| Missing auxiliary milestone | That milestone was not observed before assessment settled, not proof the supplier never sent data. |
| Selection unknown/unavailable | Captured selection evidence is absent or could not be read, distinct from unknown task demand. |

There is no assessment retry or automatic deadline extension. Caller cancellation
aborts the turn rather than invoking fallback. Auxiliary calls can add latency
and supplier charges outside native answer Usage.

## Requirements

Auto must explain why the initiating turn chose its actual route, not display a
generic description of prompt length. Intelligence prioritizes response quality
but can use a lightweight model for demonstrably simple work. Efficiency favors
economical capability without knowingly underpowering difficult work. Balance
trades those priorities. All preferences share the same account model pool.

The authenticated account `/models` response supplies `model_picker_category`.
The October 3, 2026 bounded live probe observed `powerful`, `versatile` and
`lightweight`; some records lacked the field. This is supplier classification,
not measured latency, quality, price or health. Official documentation's
`category` is a different source and must not override live account facts.
Do not derive category from IDs, names, reasoning effort or context capacity.

Hard constraints remain first: entitlement, exclusions, current proof, text/image
capability and actual image format, estimated input headroom and final native
admission. No preference overrides these. No new Core owner, adapter, credential
record, general transport, global model mutation or durable decision event.

## Task assessment

Assessment concerns the task in context, not the last sentence's length.
An isolated greeting may be low demand. A short request to prove a theorem or
continue an unresolved investigation is not evidence of low demand. Long input
can be mechanical. Prior assistant/tool work prevents a greeting/continuation
shortcut from claiming an isolated simple task.

Use conservative local assessment first. Unknown is an explicit outcome, never
silently translated into simple. Semantic assessment is enabled by default for
locally unknown demand at the user's explicit rollout request (#267), not
because labeled-corpus calibration has completed. Set
`github-copilot.autoSemanticAssessment: false` to disable auxiliary inference;
an existing explicit false remains respected. It must not claim equivalence to
GitHub's private router or calibrated confidence.

Local rules recognize an isolated, explicit JSON-to-CSV/CSV-to-JSON conversion
or line sort only when the entire request is at most 1600 characters, contains
one fenced payload and no other work or non-text content. This establishes
routine, not simple. An exact acknowledgement/continue request can inherit
explicit difficult-task evidence from the nearest non-continuation user request
among the preceding twelve user requests. A new task or an expired anchor stops
inheritance; simple/routine demand is never inherited.

`uncertain` remains a valid task result. `insufficient-evidence` means the local
rules cannot establish demand, not that the conversation has no context.
Attachments, unfamiliar instructions and genuinely ambiguous continuations can
still remain unknown. These refinements do not change category preference,
previous-model eligibility or semantic safeguards.

The semantic assessment uses one fixed concrete account candidate through the
existing managed native adapter, never an Auto ID and never `ctx.llm` routing
recursion. It has no tools, bounded text-only assessment context, bounded JSON
output, one deadline, cancellation and no new retry loop. Text from messages is
untrusted data, not router instructions. Files/images/reasoning/replay bodies
are not read; omitted context makes classification uncertain and cannot justify
downshifting. Assessment input is a separate projection: the actual chat
messages, system prompt, tools, attachments and history stay untouched.

Only locally unknown tasks invoke the enabled assessment. Context packing keeps
the current and nearest preceding user requests before recent output, then
restores chronological order. At most twelve complete JSON rows, 1600 text
characters per row and 8000 serialized characters are retained; JSON escape
expansion is included in this bound. Any truncation, skipped row or non-text
content still marks omitted context and prevents a semantic simple/routine
downshift. Prioritization does not prove omitted output irrelevant.

The strict result contains demand (`simple`, `routine`, `complex`, `unknown`)
and finite evidence signals, not a model ID, raw reasoning or an uncalibrated
confidence percentage. Invalid/truncated/failed results retain the local
assessment with an explicit diagnostic. Caller cancellation aborts the turn
instead of falling back. Credential, metadata and account revocation remain
fatal through existing lease/admission guards. Extra calls incur supplier
charges and latency, separate from native chat Usage and without inferred cost.

## Auxiliary latency evidence and bounded output (#272)

The assessment still has one **8-second end-to-end deadline**, including account
discovery/preparation and the native call. It does not retry on timeout or try a
second classifier. The response budget is now 128 output tokens, with compact
demand JSON and at most three fixed signals requested. The strict decoder
retains its seven-signal compatibility bound; raw explanation, confidence
percentages and reasoning are not requested. Truncation remains failure, never
accepted partial JSON.

One monotonic deadline is checked after context packing, discovery and native
preparation, before native request admission, on delivered chunks and before
accepting a decoded result. A delayed event-loop timer cannot authorize a
late auxiliary request or result. It can still delay observed settlement:
this is not a hard real-time guarantee or evidence of a supplier latency cause.
The owned timer and abort listener are disposed when assessment settles.

Among eligible supplier Lightweight text candidates with the existing input
headroom, prefer advertised reasoning `off`, then deterministic ID ordering.
This does not infer speed, health or quality from effort or model names, and
does not launch a second candidate if native support is absent.

Request `off` reasoning only when both current supplier metadata advertises it
and the public prepared model lists an `off` effort. Supplier metadata alone
does not establish native support: current managed reasoning maps can decline
`off` even when advertised. In that case retain native policy, do not change
shared model maps, guess a wire value or patch Core. No claim that reasoning is
disabled for all classifiers is made.

Captured Host-lifetime selection evidence now includes a bounded public
classifier ID, configured waiting budget, total monotonic assessment elapsed
time, adapter-invocation start, first nonempty text time, native stop/non-stop
finish observation and strict result-validation status. Preparation is included
in total time; adapter start is **not HTTP dispatch**, first text is **not first
network byte**, and these milestones cannot distinguish connection, supplier
queueing or computation. Absence says no milestone was observed before
settlement, not that the provider never emitted data. Counts are characters,
not tokens/credits; no prompt, text, replay, credential, error body or hash is
captured. Late callbacks cannot rewrite a settled decision.

The existing strict explicit-Session/turn Remote carries this optional evidence;
old explanations remain decodable without it. Numeric/model evidence is copied
and frozen in the bounded store and routing decision, not durably appended or
reconstructed after restart. The footer says assessment timed out, demand
remained unknown, and preference policy selected the category as a fallback.
Progressive details show milestones separately from native answer Usage.
Continuity copy states the fitting category-pool count and explicitly disclaims
semantic ranking; all-input-fit counts are not the final category pool.

This is instrumentation and bounded output optimization, not a measured latency
improvement or classifier calibration. No latency-ranked classifier pool,
cross-turn assessment cache, cooldown, adaptive deadline or extra probe is
introduced without reviewing real observations. Existing local evidence,
omitted-context downshift protection, cancellation, account/proof revocation,
same-turn single-flight, eligibility and category policy remain unchanged.

## Category policy and continuity

| Task demand | Efficiency | Balance | Intelligence |
| --- | --- | --- | --- |
| Proven simple | Lightweight | Lightweight | Lightweight |
| Routine | Lightweight | Versatile | Powerful |
| Complex | Powerful | Powerful | Powerful |
| Unknown | Versatile | Versatile | Powerful |

These are declared routing policies, not benchmark rankings. Efficiency's
routine lightweight selection is an economical approximation, not proof of
equal output quality. Intelligence never treats short length alone as simple.

When the target has no fitting candidates, use the disclosed category fallback:
powerful -> versatile -> lightweight; versatile -> powerful -> lightweight;
lightweight -> versatile -> powerful. Unclassified candidates are a final
explicit fallback only, not fabricated categories. Unknown/new category values
remain unclassified with a bounded catalog diagnostic.

Within the first available category, retain the previous managed model only
when it remains eligible and suitable. Otherwise use stable equal-weight
Session/turn selection with deterministic ID ordering as a tie breaker. Do not
infer quality from that ordering or assign fabricated weights. Once admitted,
all steps/retries share the turn decision. Continuity reduces unnecessary
switches but is not a claim of supplier cache savings.

If no model fits, preserve the existing largest-admissible-input recovery
branch and its native compaction diagnostics. Explain that no candidate fits;
never label this as a successful preference match or silently trim history.

## Explanation contract

Capture task source/demand/signals, assessment diagnostic, target/selected
category, fitting category count, category fallback and continuity/tie-break or
no-fit selection at decision time. Client reads the explicit viewed Session and
turn through the existing strict Remote. It does not rerun classification or
consult today's picker. Show a decisive first sentence, bounded supporting
facts and optional policy detail. Do not repeat the model name or change Usage.

Legacy records without detailed evidence show that the reason was not retained.
Host-lifetime evidence may be lost on restart; do not invent durable history or
promise cold-history reconstruction.

## Acceptance and rollout

Regress category normalization (missing/new/invalid values), short difficult
tasks, isolated greetings, contextual continuation, long mechanical input,
category fallback, previous-model eligibility, deterministic tie breaking,
no-fit recovery, one-call semantic success/invalid/failure/timeout/cancellation,
omitted context, strict Remote and footer English/Chinese explanations.

Retain native gateway, parent following, manual selection, exclusion admission,
account proof, image admission and compaction fixture coverage. Full protected
Windows/Linux CI remains mandatory before merge/release. No live inference
calls are needed for synthetic acceptance.

Default enablement is a user-authorized rollout, not an accuracy qualification.
Evaluate a reviewed labeled corpus for complex-to-simple errors, extra latency,
token use and stability across languages and prompt injection before claiming
calibrated performance. Synthetic passing tests are not this evaluation.
Missing settings adopt the enabled default after upgrade; explicit false is
not overwritten and no profile migration is performed. Publication does not
authorize profile installation or restart.
