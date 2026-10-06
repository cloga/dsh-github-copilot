# Diagnostics phase 0: boundaries and collection proposal

Roadmap: [#347](https://github.com/cloga/dsh-github-copilot/issues/347).
Phase tracking: [#354](https://github.com/cloga/dsh-github-copilot/issues/354).
Reviewed source baseline: plugin alpha.122 and official DSH
`0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84`.

**Status: phase-0 qualification and proposal, not enabled collection.**
No collector, storage domain, timer, daily task, export, issue publisher or
live-profile migration is installed by this document. Existing ephemeral
presentation evidence and sanitized errors are not a complete reliability
dataset. No historical failure rate is reconstructed.

## Decision and evidence levels

Start with account operations, identity/Checking and compaction. Keep Client
and Host populations separate. Use fixed aggregates, never a raw error archive.
Do not add an end-to-end claim by matching clocks, account IDs or Session IDs.
Do not count a summary request or background-job admission as recovery success.

| Seam | Evidence now | Decision | Remaining qualification |
| --- | --- | --- | --- |
| Plugin Client wrappers and Host controllers | Direct current implementation inspection | Instrument plugin-owned entry/settlement only in phase 1 | Exact Client/Host gateway tests, teardown and decoding failures |
| Native `session/event` compaction brackets/checkpoints | Existing plugin listener and public event contract | Count native bracket outcomes; inspect only event type and fixed ownership fields in memory | Matching commit followed by end; cancelled/failed/no-op and interrupted brackets |
| Published basic compaction `summarize` subclass hook | Existing selected plugin engine | Separate logical bracket from physical summary attempts | Segment failures, cancellation, call caps and selected-engine coverage |
| Storage domain public root exports | Exact official source/manifest inspection | Candidate for phase 2, not selected or activated | Published artifacts, actual backend route, restart/durability/clear/corruption and capacity tests |
| Native Schedule | Exact official source/manifest inspection | Not a generic collector callback or approved daily-analysis bridge | Explicit task owner/delivery, local read seam, offline/missed execution and stop semantics |
| Copilot App automation | Available coding-session tooling, not a Host data seam | Do not configure a task in phase 0 | Prove approved aggregate access in the selected execution environment |

Source inspection proves API shape, not loaded services, backend paths, package
installation or live health. The copied qualification tree has no Git metadata;
five inspected files were compared byte-for-byte through GitHub with the exact
official commit and matched. No Core or dependency file was changed or executed.
The public root package manifests declare storage-domain and schedule exports;
this phase did not qualify their published artifact bytes or a live backend.

## Observation inventory

Paths below identify implementation seams, not a request to read stored
credentials, conversation bodies or the values passed into those methods.

| Operation population | Safe observation position | Observable facts | Explicit blind spots |
| --- | --- | --- | --- |
| Models account action | `src/copilot-accounts-card.ts`: `run`, owned decoder and its `finally` | Client invocation, transport result, decode result, owner invalidation, state-settlement duration | State update is not paint completion; an unmounted Client cannot confirm visible completion |
| Models Checking/Identity | Same file: `hydrateIdentity`, `identityRead` lifetime | Client ensure invocation/join, result/decoding, invalidation, unsettled age | No proof the Host received a failed RPC; joined promise is not another physical lookup |
| Chat account selection/Checking | `src/copilot-usage-card.ts`: reads and `sessionAccount.set` | Client invocation/terminal result and stale viewed-owner rejection | Quota and identity can settle independently; do not combine their success rates |
| Global switch | `src/copilot-accounts-host.ts`: `switchAccount`; controller `@Remote switchAccount` | Host receipt, admission checks, identity/model validation stages, CAS, readback, terminal view diagnostic | Identity and model checks run concurrently; their durations are not additive; resolved Promise can contain an error view |
| Session override/inherit | `src/session-accounts-controller.ts`: `set`; `src/session-accounts-host.ts`: `set` | Host receipt, membership validation when applicable, CAS, readback, controller result | Inheritance does not necessarily perform identity/model network validation; final `get` can fail after CAS |
| Identity logical read | `src/copilot-accounts-host.ts`: `readIdentity` | Cache/cooldown/join/new-flight branch, logical result, named timeout/revocation | Successful cache read is not fresh GitHub validation; cooldown is not a new failed network attempt |
| Identity physical flight | Same method's new-flight creation and final cleanup | One started/settled flight, elapsed time, allowlisted failure | No URL, token, login, user ID, body or credential fingerprint enters diagnostics |
| Compaction logical transaction | `src/compaction-continuation.ts`: public `session/event` pattern | Start, matching compact-checkpoint commit, end, interrupted owner lifecycle | Current continuation presentation only retains selected-policy cases, not all compaction; summary event alone is not commit |
| Compaction physical summary | `src/manual-compaction-recovery.ts`: `summarizeManaged`/native `super.summarize` calls | Single versus segmented attempt, completion/error/cancellation, attempt count | Selected recovery engine only; stock/custom-engine requests must remain explicit uncovered attempts |
| Background command admission | `src/background-compaction.ts`: start and native job settlement | Admitted/duplicate/refused, job terminal state, fixed failure code | Job completion with no compactable history is no-op, not checkpoint success; reporter is not a second logical failure |
| Managed model requests (later) | `src/preview-route.ts`, `src/preview-provider.ts`: public adapter/fetch hooks | Plugin-route preparation/admission and bounded request outcomes | Native routes, provider directory and unowned transport remain gaps; inspect/fetch start is not supplier acceptance |
| Auxiliary classifier (later) | `src/auto-assessment-evidence.ts`, `src/auto-task-assessment.ts` | Existing safe preparation/adapter/text/finish milestones | Auxiliary failure is not main-answer failure; first text is not HTTP first byte or billing proof |
| Hosted search (later) | `src/traditional-search.ts`, `src/plan.ts`, `src/probe.ts` | Logical search, capability proof and final-query outcomes as distinct populations | Proof failure is not a sent user query; other providers and native directory errors remain outside this owner |

The account pilot includes global switch, Session override/inherit and identity
reads/physical flights. OAuth Add/reauthorization, removal, ordinary quota reads,
model refresh and all later request/search populations are inventoried but not
implicitly included in that first denominator. Adding them changes coverage.

### Cross-layer association

Existing strict RPC descriptors do not carry a diagnostics correlation token.
Do not alter their signatures, infer correspondence from timestamps or persist
identifiers as a shortcut. Phase 1 can deliver independent Client and Host
counts with an explicit `correlation: unavailable` boundary. A future additive
public protocol can be reviewed separately with native gateway compatibility,
short-lived token admission and teardown tests.

Within one owner, a bounded in-memory operation handle may connect start/stage/
terminal events. Native compaction matching may use the existing Session object
and compaction ID **only** while the bracket is live. Neither those IDs, account
IDs, nor their hashes are aggregate dimensions, stored records or exports.
Discard handles on settlement/disposal; never rebuild them by reading history.

## Proposed strict vocabulary

This is a proposed schema contract, not an installed Remote or runtime schema.
Phase 1 must implement a strict version-1 codec and rejection tests before use.
Unknown keys, arbitrary strings, non-finite/negative counters and impossible
stage transitions must be rejected without echoing the rejected input.

| Field | Allowed form / meaning |
| --- | --- |
| `schemaVersion` | Literal `1` |
| `pluginVersion` | Locally loaded build version, bounded validated package version; never infer from installed files |
| `coverageVersion` | Literal reviewed inventory revision; changes split comparison populations |
| `layer` | `client` or `host`; do not merge rates across them |
| `operation` | `account-global-switch`, `account-session-select`, `account-session-inherit`, `identity-read`, `identity-flight`, `compaction`, `compaction-summary`, `compaction-job-admission` |
| `stage` | Operation-specific subset of `admitted`, `rpc-invoked`, `host-received`, `identity-validation`, `model-validation`, `cas`, `readback`, `response-received`, `decoded`, `client-settled`, `summary-attempt`, `checkpoint-committed`, `ended` |
| `outcome` | `success`, `no-op`, `cancelled`, `policy-rejected`, `revoked`, `environment-fault`, `failed`, `unknown` |
| `reason` | Fixed allowlist below, `none` or `unknown`; never an Error message/stack/cause serialization |
| `count`, `durationBucket`, `ageBucket` | Safe bounded integer counters and fixed bucket enum; monotonic elapsed time, not cross-process clock subtraction |
| `coverage` | Fixed flags/counters for unavailable seams, paused intervals, dropped operations, unknown results, discarded evidence, saturated counters and interrupted owners |

Initial reason candidates: `COPILOT_ACCOUNTS_BUSY`,
`COPILOT_ACCOUNTS_CONFLICT`, `COPILOT_ACCOUNTS_CHANGED`,
`COPILOT_ACCOUNTS_COMMIT_UNCERTAIN`, `COPILOT_ACCOUNTS_IDENTITY_TIMEOUT`,
`COPILOT_ACCOUNTS_IDENTITY_UNAVAILABLE`, `COPILOT_ACCOUNTS_MODELS_FAILED`,
`COPILOT_ACCOUNTS_SETTINGS_UNAVAILABLE`,
`COPILOT_SESSION_ACCOUNTS_UNAVAILABLE`,
`COPILOT_SESSION_ACCOUNTS_COMMIT_UNCERTAIN`,
`COPILOT_ACCOUNTS_IDENTITY_TLS`, `COPILOT_ACCOUNTS_IDENTITY_NETWORK`,
`COPILOT_ACCOUNTS_IDENTITY_RATE_LIMITED`,
`COPILOT_ACCOUNTS_IDENTITY_AUTH_REJECTED`,
`COPILOT_ACCOUNTS_IDENTITY_HTTP_ERROR`, `COPILOT_ACCOUNTS_IDENTITY_INVALID`,
`COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH`, `CONTEXT_WINDOW_EXCEEDED`,
`COPILOT_MANUAL_RECOVERY_FIXED_PREFIX`, `COPILOT_MANUAL_RECOVERY_INDIVISIBLE`,
`COPILOT_MANUAL_RECOVERY_CALL_LIMIT`, `COPILOT_MANUAL_RECOVERY_EMPTY_SUMMARY`,
`COPILOT_MANUAL_RECOVERY_UNBALANCED`, plus collector-owned fixed
`rpc-unavailable`, `decode-invalid`, `summary-invalid`, `storage-unavailable`,
`storage-invalid`, `storage-write-failed`, `observer-unavailable` and `unknown`.
Finalize this allowlist against the owning schemas in phase 1; a missing code
must map to unknown, never leak the original string. Bounded Error cause-chain
inspection may extract only exact known tokens, never retain the Error.

Classify from verified origin, not just a shared code: busy/CAS rejection is
normally policy-rejected; credential invalidation is revoked; user cancellation
is cancelled only with actual cancellation evidence. Missing service is an
environment fault. Identity-unavailable/models-failed are sanitized but broad:
they do not prove network, authentication or code defect. A hung promise is
unsettled, not a declared failure. Terminal observations are idempotent: a Host
failure plus Client error plus job reporter must not become three failures in
one logical population.

## Denominators, slow operations and success

Each layer/operation starts its own denominator at actual admission. Report
started, settled by outcome, unsettled, interrupted and dropped separately.
Phase 1 should collect every eligible success and failure, not errors only.
For one uninterrupted owner, the accounting invariant is:

`started = settled + live-unsettled + interrupted`

Dropped admission is a separate lost-opportunity count, not a fake success or
terminal failure. A restart before persistence creates an unknown gap, not a
historical interrupted count of zero. Do not report failure rate from starts
while many are unfinished; show settled/started and all outcome counts.
Cancellation/policy rejection/environment faults are not folded into code
failure rate. Sum physical summary/identity attempts separately from logical
operation counts; cache hits and joined calls keep their actual semantics.

Proposed fixed duration/age bins in milliseconds:
`[0,100)`, `[100,500)`, `[500,1000)`, `[1000,5000)`,
`[5000,15000)`, `[15000,60000)`, `[60000,300000)`, `[300000,+infinity)`.
These are descriptive bins, not calibrated alerts. Monotonic clocks and bounded
owner-local age snapshots can detect pending work without cancelling it,
polling credentials or changing timeouts. UI unmount/Host teardown closes
coverage as interrupted; it must not silently declare the operation completed.

Account CAS fulfillment is not the entire operation's success: require the
existing owning readback and valid terminal view. Client state settlement still
does not prove a painted UI or the Host's inner stages.
Compaction success requires a matching **native compact-checkpoint commit and
successful native end**. An error after a commit is a distinct failed-after-
commit observation, not an assertion that no history changed. Record observed
commit independently of terminal status; no-op, prune-only reduction and unknown
commit remain distinct. Do not inspect checkpoint content, summarize the history
or rewrite native events/Usage to obtain evidence.

## Privacy and control proposal

No prompts, assistant/tool content, replay, grants, device codes, raw responses,
settings values, identity/login, account/Session/job/message IDs or hashes, URLs,
paths, arbitrary exception text, stacks or freeform labels. Fixed stage codes
and numeric aggregates are the entire data boundary. Native source/transaction,
retry, account selection, authorization, accounting and cancellation stay owned
by their existing implementations.

Collection controls must distinguish disabled, active, paused and unavailable.
Enabling collection does not authorize persistence, export, scheduling, uploads,
paid probes or repairs. Clearing evidence is not disabling collection; pause
records a coverage break and does not fabricate normal outcomes. Phase 1 should
default off until its control surface and enable scope are reviewed. Collector
failures remain explicit fixed diagnostics without rejecting/retrying the
operation being observed or silently writing a fallback log.

The collector must bound live handles and aggregate dimensions before allocation,
report overflow/saturation, and tear down timers/listeners completely. Proposed
phase-1 limits are 128 live handles per owner and a 1 MiB encoded snapshot ceiling;
these are implementation-review candidates, not already enforced guarantees.

## Storage qualification and proposed phase-2 policy

Public candidate:
[`@deepseek-ai/dsh-storage-domain`](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/storage/storage-domain/src/index.ts).
Its root exports `defineDomain`, `domainTable`, `DomainFacility` and the `Domain`
types. `ctx.storageDomain.open(spec)` selects a configured public backend;
`table.put/update/delete` and `global.set` await backend durability before
publishing memory changes. `update` serializes one-record read/modify/write.
`close` rejects new writes and drains accepted work. The caller owns the handle.
Absent route/backend, unsupported facet or invalid medium is an error, not
permission to open an ad-hoc file or use Settings as a log store.

Important constraints: there is no documented multi-record transaction for
atomic clear; `open` loads all records; returned values are not defensive copies;
the backend determines crash durability and physical capacity. A logical byte
limit is not a filesystem quota. Use one bounded strict aggregate snapshot or
prove interruption-safe multi-record semantics before choosing a layout.
Do not enable `backup-and-skip`: it may retain corrupt records and log underlying
causes, violating the proposed no-raw-data contract. Prefer fail-closed open with
a fixed corruption diagnostic; explicit clear/reset must operate through a
qualified public seam and report whether inaccessible corrupt storage was
actually removed. Do not promise clear can repair an unopenable domain.

Proposed policy, pending backend/runtime tests and review:

- 14-day rolling UTC-hour aggregates; expiry at write/read/startup, no raw events.
- Hard proposed 2 MiB encoded snapshot and 336 hourly windows, plus a bounded
  reviewed version/dimension inventory; enforce whichever bound is reached first.
  Eviction and current retained bounds are explicit. Do not silently merge versions.
- Do not persist operation handles. Persist only aggregate unfinished counts by
  safe stage if reviewed; after restart they are interrupted/unknown evidence,
  never resumable handles or an invitation to replay work.
- Clear increments an aggregate epoch and removes only the plugin domain's data;
  pause/disable/clear have independent results. Prevent accepted pre-clear writes
  from resurrecting the earlier epoch. Do not reset credentials, Settings/history
  or existing Auto observations.
- Missing/unavailable/corrupt storage yields evidence-unavailable, never an empty
  healthy report. No fallback to files, Client storage, logs or another backend.

Stage 2 must qualify exact published artifacts and synthetic restart, backend
failure, queue saturation, bounded load, expiry, clock rollback, clear races and
corrupt-medium behavior. No storage dependency or route is added in phase 0.

## Scheduling qualification

[`@deepseek-ai/dsh-schedule`](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/schedule/schedule/src/index.ts)
is a durable reminder service with public create/list/catalog/history/update/
delete management and after/at/every/daily/weekly/cron record types. It requires
Agents, Sessions, tools, storageDomain, Session controller and persistence.
[Runtime delivery](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/schedule/schedule/src/runtime.ts)
resolves an Agent, appends a reminder through `followup`, flushes native Session
persistence and records delivery. It is **not** a public arbitrary callback
scheduler, nor a promise that a coding session can read the plugin's domain.
Creating a reminder changes native inbox/history and can lead to model work:
do not use it as hidden passive monitoring.

Before stage 3, select exactly one mechanism, name its owner, approved read
endpoint/data range, local environment, timezone, missed-run policy, report
destination and stop/delete path. A Copilot App automation may start a coding
session, but must separately prove access to the intended live Host's sanitized
aggregate reader. Service presence, task admission, execution and successful
data read are four distinct facts. No timer, automation or reminder was created.

## Phase-1 acceptance and later decisions

The next PR must implement the reviewed codec/controls and bounded in-memory
account/compaction pilot, not persistence or scheduling:

1. Test real Client and Host gateways independently; transport/decoding/stale
   result failures, cache/join/cooldown and successful denominators must differ.
2. Test settled-once handles, concurrent stages, cancellation/revocation, slow
   pending age, overflow, clock behavior, pause/clear and owner teardown.
3. Exercise unchanged native compaction start/attempt/commit/end, no-op,
   failed-after-commit, invalid summary, replay scope, capacity and cancellation.
   Stock/custom engine gaps must remain visible; do not patch their internals.
4. Test privacy with hostile errors, nested causes and arbitrary fields. Neither
   failed input nor sensitive sentinel can appear in reports, logs or storage.
5. Preserve original operation results and existing UI/native behavior; run the
   complete required CI. Installation and loaded-version acceptance are separate.

Phase-2 persistence and phase-3 daily reads require separate qualification and
review. Stage 4 adds the inventoried request/classifier/search populations.
Stage 5 compares the same operations, coverage versions, loaded plugin versions,
windows and denominators. Sample sufficiency and thresholds are declared before
claiming improvement; no data remains insufficient evidence.

Owner for the next decision: the repository maintainer reviewing #347.
Trigger: approval of this boundary/schema/control proposal before phase-1
activation. Action: implement the pilot with a linked acceptance PR, or retain
unavailable seams and narrow the scope. This phase closes only #354, not #347,
and makes no claim that #346's Checking fault has been reproduced or repaired.
