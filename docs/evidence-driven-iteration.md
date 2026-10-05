# Evidence-driven iteration

Complex features must retain the link between observations, decisions and
follow-up evaluation. A dashboard alone does not ensure contributors read the
evidence. Auto is the first required pilot (#332).

## Before implementation

Read the last feature review and unresolved follow-up. State whether the
hypothesis is retained, changed or deferred. Declare policy version, observation
window, denominator and limitations: `observed`, `not-collected`,
`insufficient-sample` or `unavailable`. Missing data is not a passing result.
Define the expected improvement, guardrails and sample sufficiency before
analysis. Total turns alone are insufficient when candidate opportunities differ.

Record alternative validation when live observations are absent. Synthetic
distribution tests, types and native fixtures do not prove real workload quality,
billing or live activation. A review is not permission to implement everything
previously discussed or collect sensitive data.

## Required Auto review

`docs/auto-iteration-review.json` is the latest repository-safe decision record.
The Auto task plan starts by validating and reading it before implementation:

```sh
node scripts/iteration-review.mjs --report docs/auto-iteration-review.json
```

The bounded dependency-free command validates structure, not the truth of
conclusions. It never scans profiles, calls DSH, reads credentials or uploads
data. Unknown fields are rejected; invalid input is not echoed. Human review is
still necessary to remove sensitive prose.

For routing, assessment, cost weights, continuity or assistance-policy PRs,
reference the review and its status, policy version, window/sample denominator,
decision and validation. Name the post-delivery review owner, trigger, metric
and action. Unrelated changes use N/A. CI checks the report and workflow wiring;
it cannot prove an author read the data or understood it.

## Measurement contract

- Count decisions once per Agent/turn. Tool steps and retries are not new
  decisions. Selected, attempted, delivered, finished, failed, cancelled and
  unknown have different denominators; completion is not task success.
- For each eligible final-pool candidate capture effective weight, opportunity
  and conditional expected share. Compare summed expected versus actual
  selections, not raw percentages that ignore eligibility.
- Split category/eligibility changes from within-pool allocation and continuity.
  Keep policy versions and candidate-set changes separate. Stable deterministic
  seeds do not establish independent random trials.
- Record assessment source/outcome and timing only at observable boundaries;
  adapter-first-text is not HTTP-first-byte.
- Do not infer credits from tokens, balance deltas or incomplete usage.
  Unknown costs stay unavailable. Cache rates do not prove switching losses.

The first high-cost implementation retains bounded, local Host-lifetime
selection observations. At most 64 live Agent owners and 128 turns per owner
are retained; summary detail is bounded to 512 model/category/marking/continuity
strata and explicitly reports truncation. The current Session export includes
its retained observation timestamps. Restart, disposal and eviction lose
evidence; there is no complete traffic denominator or durable collector.
See [high-cost requirements](./auto-high-cost.md).

## Privacy

Do not collect prompt/answer/tool content, replay, grants, account names or raw
Session IDs in reports. Do not write custom durable Core history events or
modify native Usage. Raw exports stay outside Git. Local read-only exports are
not automatic uploads; sharing requires approval for the specific data and
destination. Persistence requires a reviewed public storage seam, retention
and clearing, not an implicit extension of this pilot.

## Post-delivery evaluation

Publication and effectiveness evaluation are separate milestones. Close the
delivery issue normally, while retaining a linked review task with an owner and
declared candidate-opportunity sample trigger. Review before the next policy
change even if that trigger is not met.

At review time, check sufficiency first. Record retain/change/defer, expected
versus observed behavior, regressions and uncertainty. Replace the latest
review instead of accumulating empty templates. If data remains absent, defer
explicitly and revise the collection action; never fabricate a favorable result.
No automatic reminder, paid advisor invocation, upload or self-tuning is
authorized by this workflow.
