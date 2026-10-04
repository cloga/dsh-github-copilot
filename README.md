# dsh-github-copilot

[![CI](https://github.com/cloga/dsh-github-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/cloga/dsh-github-copilot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cloga/dsh-github-copilot?include_prereleases)](https://github.com/cloga/dsh-github-copilot/releases)
[![License](https://img.shields.io/github/license/cloga/dsh-github-copilot)](./LICENSE)

**English** | [简体中文](./README.zh.md)

GitHub Copilot account discovery, contextual Auto routing and hosted search for DSH. The plugin reuses DSH's published native adapter, retaining a profile-wide account default with independent Session next-turn choices; it does not patch Core or maintain a second model catalog.

The [account requirements and design](./docs/copilot-accounts.md) cover
independent official authorizations in the existing credentials service.
**Models → Manage → GitHub accounts** manages authorizations and the global default.
Inside **Credits**, choose a saved account for this Session's subsequent turns or
restore **Follow global default**. Running turns retain their original account.
Identity display accepts GitHub Enterprise Managed User names, including their underscore-separated enterprise suffixes.

Visible Models and Credits renew expired identity without forcing fresh reads on every mount: ten-minute identity cache, shared per-account requests and a thirty-second failure cooldown. Explicit refresh retries immediately; quota can settle while identity renews. Unknown or revoked identity is never shown as current, and Session account isolation is unchanged. See [account lifecycle](./docs/copilot-accounts.md).

**Source candidate: `0.4.0-alpha.106` (unreleased). Supported host: official DSH / Windows Desktop `0.2.0-rc.2`.** Earlier DSH pins are historical evidence, not supported installation targets. Publication, profile installation and the version loaded by a running Host are separate states. The versioned commands below are for this candidate after publication, not evidence that its assets exist.

## What you can do

| Task | Where to start |
|---|---|
| Sign in and manage account models | **Settings → Models → GitHub Copilot → Sign in** |
| Add or switch GitHub accounts | **Manage → GitHub accounts**; managed-only profiles |
| Select this Session's next-turn account | **Credits → Switch account**; saved authorizations only |
| Exclude or restore individual models | **Manage → Model preferences** |
| Choose models automatically | Pick **Auto · Balance**, **Auto · Efficiency** or **Auto · Intelligence** |
| Follow a parent model in supported subagents | **Plugins → dsh-github-copilot → Details → Follow parent model** |
| Choose primary/fallback search providers | **Plugin details → Web search** |
| Read account Credits and context evidence | Copilot Session composer; native Turn Usage stays separate |

![Account controls and model preferences from the published Client](./docs/images/copilot-model-preferences.png)

Actual published Client components with synthetic models in an isolated browser. This screenshot demonstrates presentation, not live sign-in, model availability, search or loaded Desktop state.

![Switching between saved GitHub accounts in Models](./docs/images/copilot-accounts.png)

![Read-only current GitHub identity in Credits](./docs/images/copilot-accounts-credits.png)

The account images show the earlier account-management components with synthetic accounts and quota in an isolated browser. The current Session switcher is inside Credits; these images show account management and identity presentation, not real authorization, supplier availability, live account data or loaded Desktop state.

## Install and sign in

Use the exact verified release, the intended profile and an authorized package source. No `copilot2api`, external gateway, pasted GitHub token, placeholder key or separate `dsh-web-search-provider` is required.

Before installation, extract the checksum-verified archive and run its **read-only composition preflight** with absolute paths:

```sh
node package/scripts/check-search-composition.mjs --profile-dir /absolute/profile --home /absolute/DSH_HOME --install-anchor /absolute/dsh/package.json
```

Supply any launcher patches with repeated `--patch /absolute/file`. Require `supported: true`: the install command does not automatically run this preflight. Unsupported/custom Web composition and `NONEMPTY_DISPOSABLE_PROFILE_ROOT` are stop conditions. Preserve a nonempty root and review whether public composition reconstructs it before any separately approved normalization; never assume it can be cleared. Check effective shared-peer resolution so stale profile-local packages do not shadow Desktop's official peers.

For a **standalone named profile**:

```sh
dsh plugin --profile web add https://github.com/cloga/dsh-github-copilot/releases/download/v0.4.0-alpha.106/dsh-github-copilot-0.4.0-alpha.106.tgz
```

For **Desktop**, its native package manager accepts `dsh-github-copilot@0.4.0-alpha.106` after publication. Official rc.2's **Desktop-bundled CLI** also supports reserved-profile plugin management; a global/generic `dsh` shim is not equivalent. Qualify the installed entry before use. See [Desktop CLI qualification](./docs/npm-distribution.md#desktop-bundled-cli-on-official-rc2) and the distinct [standalone offline procedure](./docs/npm-distribution.md#controlled-offline-cli-maintenance-for-standalone-profiles). Neither path authorizes registry-policy bypass, peer patches or configuration deletion.

After an approved reload/restart:

1. Open **Settings → Models → GitHub Copilot** and select **Sign in with GitHub**. No native provider or manual model definition is needed.
2. Copy the displayed one-time code and complete GitHub's device flow in your own browser. Desktop uses its system-browser handoff; a selectable verification URL remains available if it does not open.
3. Wait for **Signed in** and account discovery, then choose a model. Opening Models and normal use ensure missing/stale metadata; **Manage → Refresh models** is an intentional forced refresh, not routine setup.

Sign-out requires an explicit action and removes only the active account's authorization, not other saved grants or route settings. Upgrades preserve existing native Copilot profiles; two groups can remain until [explicit single-route migration](./docs/single-route-migration.md). Installation never migrates conversations or defaults.

In **Manage → GitHub accounts**, adding an account never replaces the global default. A confirmed switch changes future inherited turns, not running turns or explicit Session overrides. **Credits → Switch account** persists a choice only for this Session's subsequent turns; **Follow global default** clears it. Explicitly choosing today's default still remains a Session override. Native-route or incomplete evidence blocks account switching. The new account may not offer your selected model, and old encrypted replay may be account-bound: no automatic model substitution or history removal occurs. **Reauthorize** renews the same saved identity; **Remove** deletes only an inactive saved authorization and cannot mutate a running turn's pinned account. Missing/revoked accounts never fall back.

Completed managed turns show **Account** beside native Usage. It records the request account, not billing or subagent totals. Evidence is bounded to the Host lifetime; restart, cold history or missing delivery displays unknown, never reconstructed from the current picker/default.

Account eligibility reads official rc.2 SettingsForms values, without requiring the retired settings `get()` API. Missing or malformed configuration remains incomplete evidence; upgrading does not bypass native-route or activity restrictions.

`COPILOT_ACCOUNTS_BUSY` is reevaluated from current activity, not retained after work ends. Use **Refresh account information** to update the open card after relevant work settles. If only the active account is listed, first **Add GitHub account**; **Switch** appears beside another saved account.

**Desktop lifecycle:** disable/remove/upgrade can require a full cold restart for Web service recomposition. If the plugin is Off and the native manager reports only `pending (waiting for service: web)`, do not repeatedly toggle or reinstall. Obtain restart approval and follow [rc.2 lifecycle guidance](./docs/web-lifecycle-rc2.md).

## Auto and model preferences

All three Auto preferences use the same account-verified, non-excluded eligible pool. Hard input/image capability checks run before soft task preferences.

| Task demand | Efficiency | Balance | Intelligence |
|---|---|---|---|
| Proven simple | Lightweight | Lightweight | Lightweight |
| Routine | Lightweight | Versatile | Powerful |
| Complex | Powerful | Powerful | Powerful |
| Unknown | Versatile | Versatile | Powerful |

Categories come from authenticated supplier metadata, not model names, context capacity or measured quality rankings. A suitable previous model is retained; otherwise the plugin uses stable equal-weight allocation within the eligible category. Category fallback is explained explicitly. One real model stays fixed throughout each admitted turn's steps, retries and compaction.

Semantic assessment is **enabled by default only for locally unknown tasks**. It makes at most one bounded auxiliary call with an **8-second end-to-end deadline** and **128-token output budget**. Set `github-copilot.autoSemanticAssessment: false` to opt out. Timeout/invalid output leaves demand unknown and uses the preference fallback; it never means simple or triggers another classifier. Caller cancellation and account invalidation remain terminal. Auxiliary calls add latency and supplier charges outside native answer Usage.

The deadline is checked against a monotonic clock at preparation, native request and result boundaries, even if the event loop delays the timer. Such delays can postpone settlement; they do not authorize late dispatch or late-result acceptance. Eligible Lightweight classifiers advertising reasoning `off` take precedence, with deterministic ID tie-breaking; the request uses `off` only if the public native model also supports it. This is not a measured speed ranking. Explanations distinguish the fitting category pool and previous-model continuity from semantic merit.

The reply's selection disclosure shows captured reasons and optional content-free auxiliary milestones. `uncertain` and `insufficient-evidence` do not mean the conversation is empty. **Selection unknown** means no retained record; **Selection unavailable → Retry** means the read failed. Retry rereads that turn, not inference. Evidence is bounded and Host-local, so restart/eviction can lose it.

When a failed/incomplete turn has no native Usage model row, the existing ⓘ opens **Turn model and selection evidence**: successful same-turn sources show **Recorded models** with incomplete failed-attempt attribution; reliable same-turn recorded request configuration shows **Requested model**, not dispatch, execution or billing proof. Missing evidence stays **Unknown**, never inferred from today's picker/default or adjacent turns. Selection reasons remain in a disclosure underneath. Complete native routes avoid repeated model UI; turns without a closing message have no existing assistant-actions entry. Native Usage and retries are unchanged. [Evidence boundaries](./docs/automatic-model-routing.md#attribution-and-explanation).

**Model exclusions** remove exact IDs from the managed picker and new Auto pools. Selected models are excludable: an admitted turn keeps its model, but a new turn/direct request cannot use an excluded ID. A fixed selection is never silently replaced. Unknown preference settings leave controls read-only, not falsely enabled. Saves use narrow native CAS without credentials, discovery or Session scans.

See [task assessment](./docs/auto-task-routing.md) and [routing contracts, exclusions and history recovery](./docs/automatic-model-routing.md).

Explicit Auto intent survives native pending-selection consumption and cold restore through a plugin-owned projection of existing selection events. Later explicit fixed choices still win for future turns; admitted turns keep their route. This does not backfill historical selection reasons or turn unknown evidence into guessed Auto.

## Subagents and search

![Current parent-following and Web search controls](./docs/images/copilot-search-routing.png)

**Follow parent model** defaults Off and applies profile-wide to supported native children/Team mates of managed Copilot parents. Fixed parents apply on each child's next turn; Auto parents pass the exact preference while each child evaluates its own context. Child-owned explicit selections win. Running turns, roots, forks, other providers and dedicated legacy policies are not rewritten. Existing legacy bindings remain independent when the broad switch is Off. [Parent-following contract](./docs/parent-model-follow.md).

**Web search** has two ordinary controls: primary provider and final fallback. Auto follows the initiating Chat provider when a corresponding search registration exists; fixed choices stay fixed when Chat changes. At most one distinct final fallback is tried, with possible charges disclosed. Cancellation/account-proof loss never authorizes a fallback.

Copilot search requires current account/protocol evidence and capability proof. Fixed/fallback Copilot preserves a nonempty legacy `searchModel`; otherwise it considers at most three account-owned Responses candidates. The final user query is sent once, never replayed across those candidates. A saved choice or successful Chat request does not prove hosted search. [Search routing and composition](./docs/session-search-routing.md).
The legacy `github-copilot.searchFallback` setting applies only to its separate
canonical inline path; it is not a third routed fallback. Fetch is unchanged.

## Usage, request limits and recovery

**Credits** shows validated account billing-cycle data, not context tokens or Session cost. Stale, pooled and unavailable readings keep their real meanings. The quota request alone uses Node plus system CA roots with TLS verification enabled; it does not change trust for sign-in, models, search or Desktop globally.

Native context occupancy and Turn Usage remain Core-owned. The plugin forwards usage unchanged, including zero samples on failure/cancellation. Its separate context disclosure reports historical evidence, never current occupancy or a replacement `0%` meter. **Turn Usage incomplete** explains missing samples/lifecycle and recorded local blocks; it invents neither zero usage nor partial totals. Cancellation can retain usage, but does not guarantee a final supplier receipt. [Usage boundaries](./docs/copilot-usage.md).

Owned timeout/replay errors preserve native usage before terminal failure restoration, including nonzero samples. A failed zero can still make the native ring show `0%`; this is not proof of an empty request. Retry-entry times describe backoff, not the failed request's duration. These accounting fixes do not cure supplier HTTP 408 or change retry policy.

Managed request admission preserves truthful input/output limits and native transactions. Automatic pressure uses the initiating Agent's actual bound compaction service; a preset without an engine cannot borrow global recovery. Already oversized manual summaries require separately selected [manual recovery](./docs/manual-compaction-recovery.md), not a promise that preventive admission can rescue them.

For continuing steps with a committed managed route and no pending model change, known input pressure is reduced before Core opens the next model attempt. Successful native reduction avoids an unsampled local-pressure attempt that would make whole-turn Usage unavailable. First steps, pending selections, new fixed-prefix growth and final hard-budget refusals retain existing admission; this does not repair historical totals or invent missing usage.

For exact verified `408 / user_request_timeout`, diagnostics describe bounded request composition and observable timing, not a proven payload limit or root cause. Image counts include native Responses tool outputs; older stored diagnostics may have counted those images as residual history. Bytes are not tokens; timing is not upload duration. Small, image-free requests can also time out. Follow [request-budget and timeout guidance](./docs/copilot-compaction.md); do not automatically trim history, disable proof, switch models or add retries.

The same failure can include request-scoped native local body-write/header milestones, negotiated TLS ALPN and a Node writable-buffer count. These are local submission observations, not kernel ACK or supplier receipt; missing events do not prove an incomplete upload. Unsupported or ambiguous transports report unavailable evidence. No request contents are logged and no connection, proxy, dispatcher or retry is changed.

HTTP/SSE liveness separates five-minute byte idle from bounded ten-minute assistant-output silence by default. Consumer work is excluded; WebSocket/explicit `auto` stays native-only. This does not cure supplier HTTP 408s. Images are admitted against actual native-projected MIME evidence; the plugin does not own conversion or infer format support from filenames. [Image compatibility](./docs/image-input-compatibility.md).

## Settings and troubleshooting

Configuration is under `github-copilot`. Credentials, endpoint definitions and a static model catalog are not plugin settings.

| Key | Default | Purpose |
|---|---:|---|
| `autoSemanticAssessment` | `true` | One auxiliary assessment for locally unknown Auto tasks |
| `followParentModel` | `false` | Supported child following; explicit child selections win |
| `excludedModelIds` | `[]` | Exact exclusions through Model preferences |
| `accountModelTtlMs` | `86400000` | 24h maximum metadata reuse, not token/proof validity |
| `accountModelFailureCooldownMs` | `300000` | 5min non-forcing discovery failure cooldown |
| `chatStreamLiveness` | `true` | Managed HTTP/SSE byte observation |
| `chatStreamIdleTimeoutMs` | `300000` | Byte-idle deadline; separate from search |
| `chatMaxRequestImageBytes` | `20971520` | Native 20 MiB outgoing-image budget, not a total JSON limit |
| `requestBudgetSafetyTokens` | `4096` | Estimated input safety allowance |
| `requestBudgetPressureRatio` | `0.9` | Early pressure with supported enabled recovery |
| `compactionReasoning` | `prefer-low` | Supported low effort only when none is resolved |
| `enabled` / `probe` | `true` / `true` | Hosted search / capability proof |
| `providers` | `[]` | Optional explicit search route allowlist |
| `includeSources` / `stripServerTools` | `true` / `true` | Inline citations / hosted-tool schema handling |
| `idleTimeoutMs` / `probeTimeoutMs` | `300000` / `30000` | Search request / probe deadlines |

| Symptom | Next safe action |
|---|---|
| No sign-in controls | Check active profile and loaded Host/Client; do not add a native provider merely to reveal login |
| Signed in, missing models | Inspect discovery diagnostics; use visible Retry or intentional Refresh, not repeated sign-in |
| Two Copilot groups | Review [explicit migration](./docs/single-route-migration.md); no automatic removal |
| Selection unknown/unavailable | Distinguish lost evidence from read failure; Retry only rereads |
| Missing/cancelled Turn Usage | Read [usage limitations](./docs/copilot-usage.md); do not infer zero billing |
| History fails on `github-copilot/auto-model-decision` | Use [detached, check-first recovery](./docs/automatic-model-routing.md#recovering-affected-histories); never replace live history without stopped writers and approval |
| AUTH, Responses replay-scope or TLS failure | Review [request diagnostics](./docs/model-compatibility-acceptance.md#authentication-replay-and-request-diagnostics) and [usage TLS boundaries](./docs/copilot-usage.md#account-data-boundary). After an exact scope rejection, **Replay recovery** appears automatically when the session's turn ends or the session opens. Review the loss of matching old encrypted items and their summaries, then authorize **Next matching turn only** (default choice) or **Continue in this session**. Both expire within one hour of the evidence and require the same validation state. Recovery itself stays off until confirmed; use native Send/Retry separately. It never rewrites history or retries automatically, and is not a 408 fix. Never reset credentials or disable TLS as an automatic repair. |
| Hosted search unavailable | Check account/protocol/probe diagnostics; a legacy override stays authoritative until explicitly reset |

## Ownership and further reading

DSH Core owns Sessions, tools, sandboxing, attachments, native accounting and other providers. `llm-pi-ai` owns OAuth, token exchange/refresh and normal model transport. This plugin composes the published adapter with authenticated account metadata; new supported account model IDs need no name-based routing patch. Credentials stay Host-only under `llm-pi-ai/github-copilot`.

Public APIs cannot replace Core Edit/Delete, restructure its flat picker or make native Add a single-route enforcement mechanism. Retired [Model roles](./docs/dual-model.md) remain compatibility-only. Fixes must stay [plugin-only](./AGENTS.md#plugin-only-implementation-boundary).

| Guide | Scope |
|---|---|
| [Compatibility acceptance](./docs/model-compatibility-acceptance.md) | Metadata, reasoning, replay and public-interface limits |
| [Current official-first review](./docs/official-first-020-rc2.md) | Exact rc.2 seams and retained gaps |
| [Migration](./docs/single-route-migration.md) | Fresh read-only readiness and explicit config-only maintenance |
| [Distribution](./docs/npm-distribution.md) | Same-byte GitHub/npm publication and qualified installation |
| [Agent guide](./AGENTS.md), [contributing](./CONTRIBUTING.md) | Owners, task plans, gates and delivery policy |

Version history belongs in [CHANGELOG.md](./CHANGELOG.md) and immutable [Releases](https://github.com/cloga/dsh-github-copilot/releases), not the setup instructions. `deployment-baseline.json` retains historical pins without admitting them as current support.

## Build and verify

Use Node 24 LTS and the exact pnpm version in `package.json`; runtime Node must be >=22.19.0.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
pnpm verify:tarball -- artifacts/dsh-github-copilot-<package-version>.tgz
```

`pnpm verify` covers contracts, types, baseline, build, tests and built entry smoke. Required CI targets unchanged official rc.2 source and published artifacts on Windows/Linux. Passing synthetic tests does not prove live account/model/search behavior.

Agents start with `node scripts/agent.mjs describe --json`, `doctor --json` and `plan <task> --json`; plans are unexecuted arguments, not action approval. Follow [AGENTS.md](./AGENTS.md) for the full change/release policy. Important updates require protected merge and verified dual-channel publication; documentation-only work does not release by default. Profile installation, sign-out and session-interrupting restart need separate authorization.

Commit attribution uses `Assisted-by` with the actual tool, never the model provider or an unverified collaborator identity.

## Release and checksum verification

GitHub Releases and npm distribute the same original verified tarball. Pin a version; verify Release SHA-256 or npm `dist.integrity`. Never repack an immutable release or move/reuse its tag.

```sh
curl -LO https://github.com/cloga/dsh-github-copilot/releases/download/v0.4.0-alpha.106/dsh-github-copilot-0.4.0-alpha.106.tgz
curl -LO https://github.com/cloga/dsh-github-copilot/releases/download/v0.4.0-alpha.106/SHA256SUMS
sha256sum --check SHA256SUMS
```

```powershell
$expected = (Get-Content .\SHA256SUMS).Split()[0]
$actual = (Get-FileHash .\dsh-github-copilot-0.4.0-alpha.106.tgz -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -cne $expected) { throw 'Release checksum mismatch' }
```

Checksums detect corruption/drift; protected workflows and repository controls establish publisher provenance. Report vulnerabilities privately through [SECURITY.md](./SECURITY.md).
