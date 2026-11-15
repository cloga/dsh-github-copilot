# Multi-turn agent autonomy evaluation

Tracking: [roadmap #442](https://github.com/cloga/dsh-github-copilot/issues/442),
pilot [#494](https://github.com/cloga/dsh-github-copilot/issues/494), and
scoped-authorization work [#491](https://github.com/cloga/dsh-github-copilot/issues/491).

This pilot evaluates bounded, structured traces rather than adding more runtime
instructions. It is an offline analysis tool, not an orchestrator, permission
engine, CI attestation, or proof that an agent actually performed the reported
actions.

## Run

Create a sanitized trace outside the repository and run:

```sh
node scripts/autonomy-evaluation.mjs PATH_TO_TRACE.json
```

The evaluator reads only the explicitly supplied JSON file (maximum 1 MiB) and
prints fixed-code results to stdout. It does not automatically inspect session
databases, transcripts, credentials, profiles, network endpoints or application
state. It writes no report or telemetry.
Invalid trace data and file-read errors produce different fixed diagnostic
codes; raw error messages and paths are never printed.

Schema version 1 allows 1–128 cases, up to 512 ordered events per case, and
16,384 events total. Every case has a unique numeric `caseId` such as `case-1`, an
`independentWorkExpected` flag, ordered events, and three measurements:
`elapsedMs`, `interventionCount`, and `costMicros`. Unknown measurements must be
`null`; they are not zero. Extra fields, free-form text, unknown event codes,
unbounded values, duplicate IDs, and malformed event shapes are rejected. Do
not encode identities or other private information in the numeric IDs.
Inconsistent task boundaries and missing outcomes are retained as fixed-code
violations; missing outcomes count as unknown rather than being inferred as a
failure.

Events use only fixed task, progress, turn, consent, action, blocker, evidence
change, verification, and task-outcome codes. Each task gets a fresh scope:
prior-task consent decisions do not carry into a later task. The evaluator flags
repeated approval requests within a user scope, repeated unchanged
blockers, protected actions without a current grant, two consecutive
no-progress turns, completion without passing verification, a blocked outcome
without a current blocker, and failure to continue declared independent safe
work after a blocker. Completed, failed, blocked, and not-run outcomes remain
distinct; tasks with no recorded outcome are counted as unknown.
An explicit grant remains in scope across tool-state and requirement changes,
but a user-scope change clears it. A repeated request does not replace an
existing grant; tool-state changes do not by themselves justify re-asking.
A blocker stays active until an explicit `blocker-resolved`
event, or a grant resolves its matching `missing-consent` blocker; a completed
outcome with an active blocker is a violation. Verification must follow a
protected action. Exit status is zero only when the trace has no violations;
invalid input, read errors and violations return nonzero.

## Pilot procedure and metrics

Use the fixed synthetic traces in `tests/fixtures/autonomy-evaluation.json` to
regress evaluator behavior. They are deliberately synthetic and are not
historical-session evidence. This fixture intentionally contains violations, so
the CLI reports them and exits nonzero.

For any real multi-turn pilot, a reviewer must separately select comparable
tasks and hand-code only the schema's fixed event codes from permitted evidence.
Do not capture or commit transcripts, prompts, identities, paths, credentials,
raw errors, or content. Keep task cohorts and their acceptance criteria fixed
before comparing runs. Report completed/failed/blocked/not-run/unknown task
counts and the known/unknown count for each measurement; do not impute missing
elapsed time, human intervention, or cost. Count failed attempts as part of cost
when that evidence is available. Preserve adverse and incomplete cases instead
of discarding them.

Synthetic tests establish only that the evaluator detects the encoded patterns.
A structured trace can still be incomplete or inaccurate. Claims of improved
agent behavior require a separately sampled and reviewed cohort, evidence of
how traces were coded, and comparison against a baseline. No behavior, causal
improvement, agent independence, human intervention rate, or cost reduction is
claimed by this repository test alone.
