# High-cost Auto: requirements and evidence

Tracking: #333. Evidence-review workflow: #332.
Post-delivery review: [#334](https://github.com/cloga/dsh-github-copilot/issues/334).
Advisor qualification: [#335](https://github.com/cloga/dsh-github-copilot/issues/335).

## Product contract

High cost is a user-owned exact-model-ID preference, not a supplier category,
quality rating, price quote or difficulty level. The setting is shared across
accounts, like exclusions. It applies to Lightweight, Versatile and Powerful
models, including newly advertised IDs without implementation changes.
Unmarked new models have ordinary weight. Unavailable saved markings survive
and apply when the ID returns. Exclusion and high cost are independent.

The existing Model preferences row gains a High cost checkbox. Changes save
immediately through a narrow public SettingsForms CAS and confirmed readback;
they never select a model, discover models, enumerate Sessions or change the
global default. Unknown preference state is read-only, not an empty marking
list. Fixed selection is unaffected. An admitted Auto turn retains its captured
decision across steps, retries and subsequent preference changes.

The snapshot is taken when Auto allocates a model, after bounded assessment and
model loading, not necessarily at `turn/start`. Once allocated, the same turn
cannot be reweighted by a later save. The current checkbox/configuration is not
historical evidence of a previous decision. A retained observation window can
contain several different turns and models; its end timestamp is not the
timestamp of the selected message's decision.

For #348, read-only native header evidence identifies the reported Astra
selection at 06:25:58 local time, while the second allocation around 06:42:18
selected a different model. The retained pre-install configuration had no mark,
and a later configuration contains it. Whole-file modification time does not
prove the high-cost leaf's save time. No decision-time saved revision or exact
save receipt was retained, so the historical cause remains unconfirmed.

`tests/fixtures/copilot-accounts-persistence-core.fixture.ts` now exercises the
native SettingsForms save, preserved volatile configuration, the production Auto
Host's captured candidate weight/share, and profile restart using synthetic
models and settings only. It proves saved marks reach new allocations in that
unchanged official Core fixture, not that the affected live Host read the mark
before the historical Astra decision. Do not hardcode a model, change live
preferences or rewrite a frozen explanation to manufacture a repair.

## Routing policy v1

1. Account ownership, metadata validity, exclusion, input modality and input
   headroom are hard requirements.
2. Assess each new turn using existing contextual local/semantic evidence.
   Preserve existing demand categories and supplier-category fallback.
3. Inside the first fitting category only, give ordinary candidates weight 1
   and marked candidates weight 0.2. Multiply an eligible previous model's
   weight by 1.5. Continuity is finite, never an early unconditional return.
4. Select from cumulative positive weights using a stable Agent/turn seed.
   Capture the selected ID, candidate weights and conditional expected shares.
   No additional model calls are made to give candidates a chance.
5. When no model fits, retain the largest-input-budget native recovery path.
   Cost cannot justify choosing a model that cannot fit.

These initial parameters are a routing policy to evaluate, not calibrated
quality or billing facts. A marked previous model has weight 0.3, lower than an
ordinary peer's 1. An ordinary previous model has 1.5. A lone fitting marked
model is selected; an all-marked pool remains usable. A marked Fast model can
answer a simple task: it has a smaller share, not an extreme-only gate.
Every eligible final-pool candidate has positive opportunity; finite workloads
need not visit every model. Stable seeds do not prove independent random trials.

The auxiliary semantic classifier is a separate call, not another main-turn
allocation. It prefers an unmarked eligible Lightweight classifier; if only
marked classifiers qualify, the existing bounded call remains available.
Within that cost tier it retains advertised-off preference and stable ID order.
Its model selection must disclose its own policy and charge limits;
never count it as an ordinary Auto decision or hide auxiliary costs in Chat
Usage.

## Measurements and acceptance

Review the previous policy report before changing weights or continuity.
Synthetic acceptance covers ordinary/marked/all-marked/single pools, every
supplier category, exclusions, capacity, category changes, stable seeds,
preference changes and admitted-turn freezing. Distribution checks use large
declared seed sets and compare actual allocation with conditional expected
shares, including a marked previous model.

Runtime evidence must distinguish a selected decision from native attempted,
delivered, finished, failed and cancelled calls. Count a decision once per
Agent/turn, not per tool step. For every final-pool candidate retain its effective
weight, opportunity and expected share; compare only equivalent policy versions
and eligibility windows. No-fit decisions have no fitting-pool distribution.
Report category, assessment source, switching/continuity and marking state at
decision time, never reconstructed from today's settings.

Initial monitoring may be bounded Host-lifetime evidence. State its window,
retained sample count, eviction and restart limits. Missing history is unknown,
not zero usage or success. A session-local snapshot is not account-wide traffic.
Persistent monitoring requires a separately reviewed public storage seam,
retention/clearing and explicit scope; do not write custom Core history events.
`autoAllocationEvidence: false` stops future candidate captures without changing
selection; older retained observations expire through the normal bounded
store lifecycle. The read-only export performs no automatic file writes/upload.

No prompt, answer, tool content, replay, credential, account name or raw Session
ID belongs in an aggregate review. Keep evidence local; no automatic upload.
Do not infer credits from token estimates or account-balance deltas. Completion
is not task success. Any quality comparison requires independently defined
validation or user feedback, with missing outcomes counted explicitly.

After delivery, the next Auto-policy issue owner reviews a declared sample
target: initially at least 200 eligible opportunities per compared model,
across at least 20 Sessions, with policy/candidate-set changes separated.
This is an initial review threshold, not statistical significance. Retain,
change or defer with reasons and revised collection action if data is missing.
Review before the next weight change even if the target has not been reached.

## Controlled assistance: approved direction, separate acceptance

A main model may explicitly request one bounded advisor analysis by naming a
goal, a specific bottleneck, distinct attempted approaches and references to
their validation results. Host verification must use public current-Agent/turn
records, not trust a model's claim that it failed twice. Repeated identical
attempts and network/auth/permission/quota problems do not establish a reasoning
bottleneck. Verified failed checks do not prove model incapability.

Require per-request user confirmation or a separately explicit standing
assistance authorization with a budget. Confirming the feature direction alone
does not authorize live paid calls during development. Verify the following
public seams before shipping: tool registration, evidence lookup/ownership,
confirmation and safe resumption, frozen-account binding and native adapter
composition. Unsupported seams require an explicit limitation or narrower
user-triggered mode; no Core patch, private registry or second wire.

Deduplicate by Agent/turn and bottleneck; one request has one tracked outcome.
Send only reviewed relevant material, with input/output/time limits and the
parent cancellation signal. Use a concrete admitted model on the frozen account,
respect exclusions/capabilities, and prohibit advisor tools, recursive Auto,
recursive assistance, automatic replay and new retry loops. High-cost marking
does not establish expertise or guarantee a different model is better.

Return advice as a tool result to the unchanged main turn. The main model
validates the recommendation before applying it. A future next-turn upgrade is
a separate policy, not an in-turn model switch. Log request, verification status,
authorization, call outcome, adoption and validation separately. Unverified
evidence stays unverified; advice returned or a normal finish is not success.
Extra calls and attributable usage must be disclosed independently, never
fabricated as native Chat Usage or actual credits.

## Delivery boundaries

The first implementation targets marking, weighted main-turn allocation and
reviewable local evidence. It does not claim an advisor tool, autonomous
escalation, persistent telemetry, calibrated quality, actual cost savings or
live model success until their own acceptance evidence exists.
Rollback removes markings or restores the prior reviewed allocation policy
through a normal versioned change; never rewrite selections or histories.
