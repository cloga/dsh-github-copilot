# Agent acceptance evidence

Tracking: [roadmap #442](https://github.com/cloga/dsh-github-copilot/issues/442),
[first increment #443](https://github.com/cloga/dsh-github-copilot/issues/443).

This source-checkout tool checks **evidence consistency**, not whether a feature
works. It extends the existing Agent contract and CLI; it is not another
orchestrator, runtime plugin surface, execution attestation or merge authority.
The plugin-only and approval boundaries in [AGENTS.md](../AGENTS.md) still apply.

## Workflow

1. Before implementation, agree on an issue, objective, non-goals and observable
   requirements. Define each check from the requirement, not from the eventual
   implementation. All listed requirements are mandatory.
2. Implement and run the relevant regressions. For bug fixes, demonstrate the
   old failure and corrected behavior when feasible. Independent acceptance
   should design adverse cases from the original requirements.
3. Commit the candidate, then run checks on that clean revision. Keep the
   contract, report and sanitized evidence in an explicitly selected directory
   outside the checkout. A contract can instead be committed before capture.
4. Record the full Git commit, exact contract-byte SHA-256, declared producer
   and environment, and one result for every requirement. Hash the actual
   evidence files. Do not fill in results for commands that did not run.
5. From the candidate checkout, run:

   ```sh
   node scripts/agent.mjs accept --contract CONTRACT_FILE --report REPORT_FILE --json
   ```

6. Include requirement IDs, source commit, contract digest, actual results and
   limitations in the PR. Sharing a local file is a separate, explicit action:
   inspect and sanitize it first. Never upload live diagnostics automatically.
   A later source commit requires a new report and appropriate revalidation.

`agent.mjs describe` and `plan <task>` expose this policy and the unexecuted
command with input placeholders. Schema 1 reads files and fixed Git commands only. Schema 2 additionally invokes
the existing bounded GitHub CI reader. Neither executes report-supplied commands,
follows report URLs, or operates a Desktop application.

## Contract format

Version 1 accepts exactly these fields for non-live checks. This example is illustrative, not
completed acceptance or evidence that the behavior has been exercised:

```json
{
  "schemaVersion": 1,
  "issue": 443,
  "task": "tooling",
  "objective": "Reject acceptance evidence from another source revision.",
  "nonGoals": ["No live profile access or automatic publication."],
  "requirements": [
    {
      "id": "reject-stale-commit",
      "expected": "A report for a different commit returns ACCEPTANCE_STALE_COMMIT.",
      "method": "unit"
    }
  ]
}
```

Use the owning task ID from `agent-contract.json`. The parser validates its
identifier shape, not the truth of the task assignment. There must be 1-64
uniquely identified requirements and 1-16 non-goals. IDs are lowercase
alphanumeric/hyphen identifiers beginning with a letter, at most 64 characters.
Text is nonempty and at most 2,000 characters. Methods are `static`, `unit`,
`integration`, `browser`, `review` or `manual`; a method is a declared evidence
category, never an instruction to execute code. `browser` and `manual` requirements
now require schema 2; schema 1 returns `ACCEPTANCE_LIVE_CONTRACT_REQUIRED`.

## Required live Desktop acceptance (schema 2)

This focused #451 extension also contributes to agentic engineering improvement;
it does not depend on #442's evaluator platform or multi-agent loop. A task that
explicitly requests post-upgrade UI acceptance must use schema 2, not avoid the
requirement by labeling it `unit`. Local npm restrictions still prohibit local
dependency recovery; they do not excuse skipping safe checks on an already-running
Desktop. Real UI actions use the existing computer-use tools and their permissions,
not this repository checker.

Use the same `agent.mjs accept` command and base contract/report fields, with
`schemaVersion: 2` in both documents. Add this contract field (illustrative):

```json
{
  "liveUi": {
    "expectedPluginVersion": "0.1.0-alpha.1",
    "panel": "models-manage",
    "checks": [
      { "id": "manage-reopen", "action": "reopen-manage", "outcome": "ready" },
      { "id": "refresh-settles", "action": "refresh-models", "outcome": "ready" }
    ]
  }
}
```

Every live check ID must exist in `requirements`; every `browser`/`manual`
requirement must occur in `liveUi.checks`. Define the required scenarios before
capture: success in a signed-in case cannot substitute for a missing no-account
or failure scenario. Report actions must match each required action; observing
a panel cannot satisfy a required refresh or reopen. There are 1-16 unique live checks. Expected outcomes are
`ready` or `actionable-failure` (the latter is for an explicitly required error
presentation scenario, never a generic failure waiver). Panels are only
`models-manage`, `plugin-details` or `about`.

The report adds exactly `liveUi` with:

| Field | Strict shape / allowed values |
|---|---|
| `appState` | `running`, `not-running`, `unknown` |
| `desktop` | `{version, source, observedAtMs}`; source `about` or `unknown` |
| `installed` | Same shape; source `disk-manifest` or `unknown` |
| `loaded` | Same shape; source `public-runtime-status`, `runtime-ui` or `unknown` |
| `navigation` | 0-2 unique-method `{method, outcome, atMs, observedAtMs, observationSource}` rows |
| `handoff` | `{state, panel}`; state `none`, `requested`, `user-absent`; panel equals contract |
| `permission` | `{state, action}`; state `safe-read-only`, `approval-required`, `user-absent` |
| `steps` | 0-32 unique-check `{checkId, action, observation, startedAtMs, finishedAtMs, observedAtMs, observationSource}` rows |

Versions are exact SemVer-like version strings, not paths, account names or raw
status output. Unknown version/source uses `version: null, source: "unknown",
observedAtMs: null`; known versions need a positive integer UTC epoch-millisecond
observation time. Desktop About establishes only the Desktop version. A disk
manifest establishes installation, **not loaded runtime**. A matching public
loaded-plugin version is mandatory for version-specific completion; otherwise
observations may be qualified, but final `ok`/`closeEligible` remain false.
Known different loaded versions return `LIVE_UI_VERSION_PREREQUISITE_UNMET`
with `request-exact-upgrade-permission`, not automation failure. A matching
download/checksum does not prove installation or loading. If the exact required
install/restart needs specific consent, an unavailable user leaves it blocked;
a broad request to continue acceptance never fabricates that consent.

Navigation methods are `accessible-control`, `supported-shortcut` or
`user-opened-panel`; outcomes are `opened`, `unchanged`, `no-candidate`. Do not
retry a method just because its action returned done with no immediate tree diff.
First obtain a fresh `get_window_state` observation. Both navigation and step
rows require `observationSource: "get-window-state"` and an observation time
strictly after the action. Observations must settle within 120,000ms and be in
recorded order; no looping or repeated check/method IDs. An opened navigation
ends navigation attempts. A second method is one supported safe alternate, not
a shell/window-manager workaround.

Step actions are `observe-panel`, `reopen-manage`, `refresh-models`; observations
are `ready`, `actionable-failure`, `error`, `timeout`, `unchanged`. For example,
record the bounded refresh interval and fresh settled ready observation; do not
interpret a transient Checking state or an action receipt as success/failure.
Actions remain subject to the real task and tool permissions. Reported permission
does not grant any. `permission.action` is `none`, `restart`, `install`,
`account-switch`, `oauth` or `paid-call`; any non-`none` or non-safe state blocks
this safe-check flow. App not running requires a blocked result, not auto-launch.

If both distinct navigation attempts fail after fresh observations, return
`LIVE_UI_AUTOMATION_BLOCKED`, not product failure. The deterministic `nextAction`
requests the specified panel once; after `handoff.state: requested/user-absent`,
it waits for the user instead of asking repeatedly. Never infer consent/panel
opening from autopilot, user absence, or an automatically unanswered `ask_user`.
After the user really opens the panel, inspect it afresh and record
`user-opened-panel`; retain prior failure context locally, without resetting the
existing task/operation failure ledger. The report is not a persistent UI
executor or an interception mechanism: hiding attempts in a fabricated report
cannot be detected.

Schema 2 check `notes` are fixed codes only: `observed`, `not-run`, `blocked`,
`failed`; all `evidence` arrays must be empty. The structured live rows replace
arbitrary files/free text. Unknown fields/values are rejected; no identities,
credentials, raw errors, conversation content, screenshots or ad-hoc logs belong
in this report. Keep reports local; the tool never uploads them.

Schema 2 always invokes the existing `ci-evidence` operation under task
`String(issue)`, exact clean current commit and its existing persistent budget.
It never trusts a report's CI boolean/JSON or resets failures. Non-green/pending
CI, missing live checks, errors/timeouts, blocked permission, unconfirmed loaded
version, or incomplete handoff makes `state: "blocked", ok: false,
closeEligible: false`. A complete consistent report plus real exact-head CI can
return `state: "reported-complete", ok: true, closeEligible: true`, but this is
**report eligibility for human review**, not proof of UI execution or permission
to close an issue. `executionVerified/environmentVerified/deliveryAuthorized`
remain false; `liveUi.source` is always `report-consistency-only`. `ciVerified`
alone is real Actions-result evidence. No trusted Desktop execution source is
invented here.

## Report format

The schema 1 report has exactly `schemaVersion`, `commit`, `contractSha256`, `producer`,
`environment` and `checks`. Version is 1. `commit` is the full 40-character
lowercase Git SHA-1 of the candidate; SHA-256 Git repositories are not supported
by this version. `contractSha256` is the lowercase SHA-256 of the exact contract
file, including whitespace and line endings.

`producer` is `implementation`, `independent-review`, `human` or `ci`. This is
**self-declared**, not an authenticated identity or proof of independence.
`environment` contains exactly `node` (a three-part numeric version), `platform`
(`win32`, `linux` or `darwin`) and `core` (an exact version, optionally prerelease).
These describe the reported execution environment, not a verified live runtime.

Each check contains exactly:

| Field | Meaning |
|---|---|
| `id` | An ID in the contract; every requirement appears exactly once |
| `status` | `passed`, `failed`, `blocked` or `not-run`; no implicit skip/waiver |
| `notes` | Nonempty bounded actual result or reason, with limitations |
| `evidence` | Up to eight `{ "path": "...", "sha256": "..." } file references |

A passed check needs at least one evidence file. Other outcomes may have no
file, but need a reason. References are relative to the report's directory,
using `/` in JSON on both platforms. Paths use portable ASCII segments, with
no traversal, absolute paths, backslashes, URLs, Windows device names or alternate
data streams. Directories may be nested. Duplicate references within a check
are invalid; checks may share one file only with an identical digest.

Contract/report files are limited to 64 KiB each and must be valid UTF-8 JSON.
Duplicate object members (including equivalent escaped names), unknown fields
and nesting deeper than 32 containers are rejected.
Artifacts are limited to 1 MiB each, 64 distinct paths and 16 MiB total.
Use small sanitized result files, not raw application/credential/history dumps.
Symlink/junction artifact components and hard-linked files are rejected.
The tool reads bounded regular files, checks their identity/stability during
reading, and verifies exact artifact bytes. It does not interpret their contents.
Document changes and Git state are checked again before returning.

## Outcomes and limits

- Exit **0**: every requirement is reported passed and all document/byte checks
  passed. This is **not** a feature, CI, review or release attestation.
- Exit **1**: documents and files are consistent, but at least one requirement
  is failed, blocked or not-run. Counts preserve each state.
- Exit **2**: invalid arguments/documents, stale commit/contract, dirty checkout,
  unavailable Git/files, unsafe paths, changed files or exceeded bounds.
  Diagnostics use fixed `ACCEPTANCE_*` codes, never input contents or paths.

Results always report `executionVerified: false`, `independenceVerified: false`,
`environmentVerified: false` and `deliveryAuthorized: false`. Artifact integrity
means that the files read matched the supplied hashes, not that a test ran or
that its conclusion was correct. Requirement descriptions, notes and producer
labels still need review. A fabricated log with a matching hash cannot be
detected by this checker.

Cleanliness covers Git-visible staged, unstaged and non-ignored untracked files
at the two snapshots, including submodule status. Ignored dependencies/builds,
unobserved changes between snapshots, malicious concurrent filesystem writers,
or a compromised checker are outside this attestation. Do not use it as a
sandbox or supply credential files as evidence. It does not prove GitHub
branch protection, actual account eligibility, installed/loaded versions or
supplier behavior.

## CI and next increments

The existing `pnpm verify` runs the acceptance tooling regressions through
`test:scripts` and the policy/template checks through `verify:agent`.
The PR template's **current** Core target must match `package.json`'s
`engines.dsh`; historical documents and fixtures are not rewritten.

This is an opt-in task-evidence pilot, not a mandatory self-reported green badge
on every PR. Required review, `release-ready` and the existing Release workflow
remain authoritative. Repository-internal tooling does not itself request a
product release, profile installation or restart.

The next increment must enforce independent evaluation in trusted execution,
bind reviewer output to the candidate and reviewed contract, protect policy/test
changes, and bound repair attempts/time/cost. Merely setting `producer` to
`independent-review` cannot implement that separation. Use native sessions/jobs
and existing Actions, not a second daemon or publication path.

After that, evaluate the engineering loop on isolated historical tasks with
held-out checks. Track full-task success, first-pass acceptance, repair rounds,
human intervention and total cost/time including failures. Small samples,
familiar tasks and unavailable production observations remain explicit limits.
Reuse [evidence-driven iteration](./evidence-driven-iteration.md) for follow-up;
no scheduling, paid calls, self-tuning or diagnostic upload is enabled here.
