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

## Routing policy v3 (#412)

1. Account ownership, metadata validity, exclusion, input modality and input
   headroom are hard requirements.
2. Assess each new turn using existing contextual local/semantic evidence.
   Preserve existing demand categories and supplier-category fallback.
3. Inside the first fitting category only, retain all fitting candidates.
   Ordinary candidates have weight 1 and an eligible previous ordinary model
   receives multiplier 1.5. Marked candidates have base weight 0.2; the previous
   marked model decays tenfold to 0.02 instead of receiving a continuity bonus.
4. Select from cumulative positive weights using a stable Agent/turn seed.
   Capture the selected ID, candidate weights and conditional expected shares.
   No additional model calls are made to give candidates a chance.
5. When no model fits, retain the largest-input-budget native recovery path.
   Cost cannot justify choosing a model that cannot fit.

This corrects v2's over-strong hard deferral after the user clarified that high
cost should have rare opportunity and strongly decay after selection, not become
permanently unavailable. The 10x repeat penalty is a declared trial, not a
calibrated optimum. It uses existing previous-route evidence only; there is no
hidden multi-turn counter, persistent penalty, time cooldown or failed-task guess.
If the same marked model repeats, it remains at 0.02 rather than recursively
shrinking. A different model's turn resets it to 0.2. Other marked models retain
base weight. A lone fitting marked model is selected and an all-marked pool
remains usable. Fit and supplier
category cannot prove peers can solve the task; no automatic escalation, extra
calls, in-turn switch or lower-category substitution is introduced.
Every fitting final-pool candidate has positive opportunity. With one ordinary
peer, a marked model has share 2/17 (11.8%) when the ordinary model was previous,
then 1/51 (2.0%) when it was itself previous. The independent-draw approximation
for a predeclared pair is 2/867 (0.23%), not the probability of any streak in a
long Session or a guarantee against repeats. Stable seeds do not prove
independent random trials. Conditional shares are not observed billing.

Historical v1 retains mixed-pool weights and marked continuity; v2 retains hard
cost-tier deferral and its deferred count. Both remain readable unchanged.
Persistent cohorts retain original policy versions.
The Session summary separates incompatible policy cohorts and reports omitted
decisions instead of relabeling them or merging different opportunities.

Read-only October 11 alpha.10 aggregates showed 3 Astra selections against
2.868 summed expected selections across 18 opportunities, without Session or
sequence identity. The requested local Session's bounded native metadata showed
five Sol turns followed by two Astra turns; its last 178 messages belonged to
one frozen turn. This does not establish a distribution violation. A conditional
two-peer seeded reproduction matches the two Astra choices, but the exact
historical pool was not retained. V2 implements the user's stricter preference,
not a claimed repair to a proven random-number defect. V3 supersedes v2's hard
exclusion with positive recency-decayed opportunity, without a live performance
claim.

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
shares, including marked previous models, all-marked/single pools, sequential
previous-route updates and backward-compatible v1/v2 evidence.

Runtime evidence must distinguish a selected decision from native attempted,
delivered, finished, failed and cancelled calls. Count a decision once per
Agent/turn, not per tool step. For every final-pool candidate retain its effective
weight, opportunity and expected share; compare only equivalent policy versions
and eligibility windows. No-fit decisions have no fitting-pool distribution.
Report category, assessment source, switching/continuity and marking state at
decision time, never reconstructed from today's settings.

The turn-selection dialog continues to expose bounded Host-lifetime evidence.
Separately, default-off Local diagnostics persists daily profile-local
allocation aggregates in the reviewed public storage domain when collection is
enabled. It records plugin/policy version, target/selected category,
demand/assessment source, model, high-cost/continuity flags, weight,
opportunities, conditional expected selections, actual selections and no-fit
counts. Retain at most 1,024 strata for 14 days under the shared 2 MiB snapshot
limit; expose restart, expiration, drops and truncation. There are no
Session/turn IDs, prompt/content, execution or task-outcome records, custom
Core history events, automatic uploads or tuning. The shared Local diagnostics
switch controls account/Checking and compaction aggregates; Auto allocation
collection has its own hidden volatile, default-off setting and can be enabled
without collecting those other populations. Missing history is unknown, not
zero usage or success, and selection remains distinct from execution, quality
and billing.

`autoAllocationEvidence: false` stops future Host-lifetime candidate captures
without changing selection; it does not disable the separately controlled
persistent Local diagnostics aggregates. The read-only exports perform no
automatic file writes/upload.

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
