# GitHub Copilot Auto routing contracts

Target: official DSH / Windows Desktop `0.2.0-rc.2`. Implementation is plugin-only.
For ordinary use, start with [task assessment and explanations](./auto-task-routing.md)
and [parent following](./parent-model-follow.md).

## User contract

The managed `github-copilot-preview` group provides **Auto · Balance** (`auto`),
**Auto · Efficiency** and **Auto · Intelligence** in Core's flat picker.
Only a real model selection exits Auto. Native selection also saves the future
global default; the plugin does not change that Core behavior.

Each admitted Core turn resolves to one real account model. Tool continuations,
native request retries and compaction retries retain it; a new user or Goal
turn can choose differently. Transport, replay, native Usage and billing retain
the actual model identity. Auto never crosses providers/accounts or changes an
explicit real-model selection.

The virtual preference remains the Session's pending selection while actual
request headers record real models. For an otherwise unselected Session that
inherits default Auto, the first request persists the exact virtual
`model/selection` intent. A later explicit selection wins. Existing fixed
Sessions are not converted because the global default changes.

## Eligibility and input fit

Current authenticated account metadata establishes entitlement, endpoint,
context/input/output limits, tool/image support and reasoning capabilities.
Missing/invalid metadata produces diagnostics, not guessed capabilities.
Exact exclusions and independent account/proof/cancellation guards apply first.

The public native TokenMeter estimates every entered message, including
reasoning and tool history. Its current-surface measurement is an envelope
floor, not a substitute for candidate-specific final serialization.
Missing/invalid measurement fails with
`COPILOT_AUTO_TOKEN_METER_UNAVAILABLE` /
`COPILOT_AUTO_TOKEN_ESTIMATE_INVALID`.

Candidates fit when estimated input does not exceed the hard budget after
output reservation and safety allowance. If none fits, choose the largest
input budget for native recovery and explain whether content is fixed,
compaction unavailable, already attempted, or eligible. This is not permission
to dispatch an oversized request. The native managed `inspectRequest` guard
remains authoritative after final framing/attachment projection.

Task preference uses supplier `model_picker_category`, not capacity, model
names or reasoning effort as quality rankings. [Task policy](./auto-task-routing.md)
owns the demand matrix, default semantic assessment, category fallback,
continuity and stable same-category allocation.

## Images, compaction and search

Image eligibility includes historical user/tool image blocks in all entered
messages, not only current user text. Text-only candidates are removed; Auto
advertises image input only with an eligible image model. Actual fixed/Auto
dispatch independently checks explicit account MIME restrictions against
Core's projected image. Missing MIME lists stay unverified.
[Image admission limits](./image-input-compatibility.md).

Auto does not trim history or own compaction transactions. Estimated pressure
uses the initiating Agent's public bound recovery service and preserves the
same real model. If the summary input already exceeds every eligible budget,
stock one-shot compaction cannot rescue it. [Budget admission](./copilot-compaction.md)
and [manual recovery](./manual-compaction-recovery.md) describe separate paths.

Chat Auto does not own independent hosted search. A nonempty `searchModel`
override remains authoritative; otherwise that provider uses bounded
account-owned Responses selection and capability proof. Auto-following search
sees the initiating real request route. No virtual model reaches transport,
and the final query is not replayed across candidates.
[Search routing](./session-search-routing.md).

## Attribution and explanation

Completed replies show **Auto (preference)** with captured reasons, **Manual**
only with explicit fixed-selection evidence, or **Selection unknown** when a
successful read has no record. Failed reads show **Selection unavailable → Retry**.
Retry rereads the same Session/turn; it never runs inference.

The public assistant-actions slot adds the plugin item after native Usage/time.
It cannot change the native fixed-height parent row, repeats no model name and
adds no Model details button. A turn without a closing message has no such
anchor. Optional conversation projections do not control selection mounting.

The bounded Host store retains 64 Agents and 128 turns per Agent. Disposal,
eviction and restart lose new records. Compatible historical Auto events remain
readable; missing historical preference/reasons are not reconstructed.
New optional `github-copilot/auto-model-decision` events are **not** emitted:
official rc.2 `Session.append()` has no public ignorable-envelope option.

`TurnSelectionController` extends public `TypertRemoteService` with `@Remote get`.
Client calls carry explicit viewed Session ID and turn, with no automatic
Client scope projection that would remove the ID. Native Host Agent lookup,
access checks and strict codecs remain. Actual Client/Host gateway regressions
cover reachability, bound contexts and missing/denied identities; mock RPC
success is not sufficient evidence.

Captured evidence includes task/category, eligible/fitting counts,
fallback/continuity and optional auxiliary milestones. It proves a decision,
not execution, current occupancy, usage or supplier billing. Native accounting
remains independent. [Usage limits](./copilot-usage.md).

### Recovering affected histories

Only histories containing the old incompatible decision event need this
compatibility utility. Upgrading prevents new writes but does not repair old logs.
From a source checkout, use Node 24 LTS and the pinned frozen dependencies:

```powershell
# Read-only validation; no conversation content is printed.
node scripts\repair-auto-model-history.mjs 'C:\absolute\path\session.v4.jsonl.zstd'

# Optional detached copy in a NEW private directory, never the live source.
node scripts\repair-auto-model-history.mjs 'C:\absolute\path\session.v4.jsonl.zstd' --write-copy 'C:\private\new-recovery-directory'
```

The utility validates the entire v4 log with the official rc.2 catalog, marks
only recognized decision envelopes `ignorable: true`, and preserves all other
logical fields. Unknown events, malformed relationships, torn tails and inputs
over 128 MiB fail closed. Copy mode refuses existing destinations and creates a
byte-exact original, validated copy and SHA-256 receipt; keep both logs private.

The corrected writer preserves a separate first zstd header frame for Desktop
discovery. The original utility combined header/events and could make a copy
disappear despite logical validation. `reframedHeader: true` reports physical
repair; zero changed event sequences alone is not readability proof.

**Applying a copy requires separate approval and stopped writers.** Recheck the
live source against `originalSha256`; regenerate if changed. Replace only that
log, compare `repairedSha256` and reopen with the official reader. Do not replay
business requests as a test. The utility never installs, restarts, writes the
source, clears credentials or performs automatic migration.

## Requested parent-to-child selection inheritance

The implemented opt-in [profile-wide switch](./parent-model-follow.md) follows
supported children on each new turn. Fixed parent selection is passed directly;
Auto passes the exact preference and evaluates the child's own context.
Child-owned explicit selections and admitted-turn freezing remain authoritative.
Legacy `parentModelFollow` bindings stay independent.

With both policies off, ordinary native children retain Core's creation-time
route snapshot. Native resolved options/descriptor v3 do not retain whether an
equal creation route was an explicit override. Enabling the plugin policy
authorizes replacing that snapshot; it does not reconstruct original intent,
fabricate descriptor provenance or rewrite Team labels.

The original [investigation #229](https://github.com/cloga/dsh-github-copilot/issues/229)
and [one-switch follow-up #234](https://github.com/cloga/dsh-github-copilot/issues/234)
record the design history. Upstream native rules/settings UI is separate work,
not a dependency or claimed shipped feature of this plugin.

## Model exclusions and richer picker boundary

**Settings → Models → GitHub Copilot → Manage → Model preferences** offers
search, All/Enabled/Excluded filters and immediate Exclude/Restore actions.
Temporarily absent excluded IDs remain restorable. Selected models can also be
excluded; legacy `lockedModelIds` remains empty.

`setModelExcluded(modelId, excluded)` returns a narrow strict preferences result
after path-level native CAS persistence. It reads no credentials, discovers no
models and enumerates no Sessions. Unknown settings make rows read-only with
named diagnostics; status-only Retry cannot imply an empty exclusion set.
The hidden volatile Config leaf persists through native projection/restart.

Directory, Auto pools/modalities, search facts and new-turn admission remove
exact excluded IDs. An admitted Session/turn/model with the exact native request
signal may continue steps/retries; `turn/end` clears admission. New turns,
unbound calls and stale picker rows fail `COPILOT_PREVIEW_MODEL_EXCLUDED`.
Account/proof/cancellation guards remain revocable. A fixed selection is never
changed automatically; restore it or select another model before the next turn.
Zero eligible candidates fails `COPILOT_AUTO_NO_ELIGIBLE_MODEL`.

Core owns flat grouping and picker search. The old
[nested-picker prototype](../output/auto-model-mockup/tiers.html) is historical
design exploration: its capacity quality scores, nested menu and simulated
responses are not implementation or model evaluations.

## Public seams and evidence limits

`PreviewAdapter.listModels/resolveModel`, `agent/pre-step`, public model-selection
middleware and `agent/request` compose the real route before request-header
persistence. Unresolved virtual Auto fails in adapter preparation/streaming.
Per-Agent/turn caching, native adapter leases, OAuth, replay and cancellation
keep their existing owners.

Required unchanged rc.2 source/published-artifact fixtures on Windows/Linux
cover eligibility, real headers, durable intent, multi-step/retry freezing,
images, native compaction, exclusions and gateway access. They do not establish
live model availability, quality, latency, price, account access or Desktop
activation. No Core/dependency/private-registry/shared-catalog/history patch is
permitted. Measured ranking, cross-provider Auto, failure-driven model switching,
side-effect replay and native picker redesign remain out of scope.
