# Environment and CI evidence guardrails

Tracking: [issue #451](https://github.com/cloga/dsh-github-copilot/issues/451).

The guarded entry point makes the execution choice explicit. It is deliberately
separate from the opt-in acceptance-evidence consistency checker and the #442
engineering roadmap; it is not an evaluator, agent loop, daemon, or product
runtime feature.

## Select one bounded operation

Use a stable task identifier (normally the issue number) and choose the
environment explicitly:

```sh
node scripts/agent.mjs guard --task 451 --environment local-auxiliary --operation scripts-test
node scripts/agent.mjs guard --task 451 --environment github-actions-evidence --operation ci-evidence --head FULL_40_CHARACTER_COMMIT
```

`local-auxiliary` runs only the fixed, dependency-free Node script test set.
It does not install or restore packages, build, typecheck, or run integration
tests. `dependency-install` is refused before a child process can start; the
guard never changes registry sources, retries installs, widens permissions, or
changes machine/network/credential configuration.

`github-actions-evidence` reads the real GitHub Actions REST results through
the authenticated `gh` CLI. It requires the explicit head to equal the current
clean checkout HEAD, the origin to identify this repository, the active
`.github/workflows/ci.yml` workflow, a completed successful run for that exact
head, and successful results for both Windows/Linux `verify` and
`Published adapter` matrix jobs plus `release-ready`. Distinct runs are ordered
by workflow run number, then run ID; attempt numbers order only attempts of
the same run. An older successful rerun cannot mask a newer failed or pending
run. Missing or invalid run ordering metadata is rejected. The normal `release` job
may be absent or skipped; it is not a required verification job. Failed,
cancelled, in-progress, stale, missing, mismatched, or skipped required results
are rejected. No report JSON, local `passed` label, session status, or inferred
workflow name is accepted as a substitute.

Each allowed operation has two execution failures per task/operation in the
worktree's Git metadata. Failed local checks and unavailable/malformed GitHub
reads consume this budget. Successfully read but unacceptable CI evidence does
not: missing or running results return `state: "blocked"` with
`evidenceState: "not-ready"`; failed, cancelled, stale or mismatched evidence
returns `evidenceState: "rejected"`. Neither state passes verification, but later
explicit reads can accept newly completed evidence without a pending-state
lockout. There is no automatic polling or retry.

Execution-failure counts survive ordinary continuation, pending results and
successful calls; there is no reset option. Once exhausted, the entry point returns
`GUARD_FAILURE_BUDGET_EXHAUSTED` without executing the operation. State is local
to that Git worktree and capped at 128 task/operation records; it is not a
defense against deliberate deletion or tampering with Git metadata. Each
evidence check stops after at most three non-paginated `gh api` calls, each
with a 15-second process timeout; it performs no application-level retry loop.

## Enforcement and evidence limits

These checks apply only when an operation is routed through
`scripts/agent.mjs guard`. They cannot intercept an agent or user running an
arbitrary shell command directly, and are not a sandbox or permission boundary.
The local tests validate the guard's behavior, not external workflow execution.
CI-green proves only that the named required jobs passed for the exact commit;
it does not establish live DSH configuration, loaded plugin state, account or
supplier behavior, business/field acceptance, or completion of a broader
engineering roadmap.

The full dependency install, build, type, unit/integration and package gates
remain the existing GitHub CI workflow. On a local checkout, run only the
guarded dependency-free script tests; do not repeatedly attempt local dependency
recovery when the configured network cannot reach npm.
