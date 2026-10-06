# dsh-github-copilot

[![CI](https://github.com/cloga/dsh-github-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/cloga/dsh-github-copilot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cloga/dsh-github-copilot?include_prereleases)](https://github.com/cloga/dsh-github-copilot/releases)
[![License](https://img.shields.io/github/license/cloga/dsh-github-copilot)](./LICENSE)

**English** | [简体中文](./README.zh.md)

GitHub Copilot account discovery, contextual Auto routing and hosted search for DSH. The plugin reuses DSH's published native adapter, retaining a profile-wide account default with independent Session next-turn choices; it does not patch Core or maintain a second model catalog.

**Current release: [`0.4.0-alpha.130`](https://github.com/cloga/dsh-github-copilot/releases/tag/v0.4.0-alpha.130). Supported host: official DSH / Windows Desktop `0.2.0-rc.2`.** This is still an alpha release, not a stable-channel promotion. Earlier DSH pins are historical evidence, not supported installation targets. Published, installed in a profile and loaded by a running Host are separate states.

## What you can do

**High-cost Auto:** in **Manage → Model preferences**, mark costly models with
**High cost**. Cost and task difficulty are independent: within the first
fitting category, ordinary models have weight `1`, marked models `0.2`, and the
previous model gets a finite `1.5×` bonus. All candidates keep a nonzero chance;
marking does not change fixed choices or admitted turns. This is a declared
policy, not a price/quality ranking or proven savings.

The existing turn selection dialog exposes **Auto allocation observations**:
local retained opportunities, expected shares and actual selections for this
Session, with a read-only JSON export. No automatic upload or durable history
is added; restart/eviction loses evidence. `autoAllocationEvidence: false`
stops future candidate capture without changing routing; previously retained
observations remain until disposal/eviction/restart. The auxiliary classifier
prefers unmarked eligible Lightweight models separately. Advisor calls are not
implemented. See [requirements](./docs/auto-high-cost.md) and the
[required iteration review](./docs/evidence-driven-iteration.md).

The [local diagnostics pilot](./docs/plugin-diagnostics.md) records bounded
account/Checking and compaction aggregates, **default off**. After installing
and loading the published build, open the plugin detail settings page →
**Local diagnostics → Read status → Enable local collection**. This enables
local persistence, not uploads or scheduled analysis. The package also has an
explicit offline analyzer for a caller-selected persisted unit or reviewed
aggregate view; it writes only to a new local report file and never scans,
uploads or changes collection. Pause preserves evidence; Clear requires
separate confirmation. Client/Host populations, uncovered paths and
reporting/storage gaps remain explicit. Descriptive counts are not reconstructed
history, failure rates or proof of an improvement.

To analyze an explicitly qualified file from a built package or source checkout:

```sh
node scripts/analyze-diagnostics.mjs --input "ABSOLUTE_UNIT_FILE.json" --mode persisted-unit --profile-name "PROFILE_NAME" --output "NEW_LOCAL_REPORT.json"
```

Replace the placeholders with the reviewed file/profile and a new absolute output path. For a reviewed aggregate view export, use `--mode reviewed-view` without `--profile-name`. [Read qualification and interpretation limits](./docs/plugin-diagnostics.md#explicit-offline-analysis-368) explain the accepted envelope, bounds and persisted-only evidence; no daily schedule is included.

| Task | Where to start |
|---|---|
| Sign in and manage account models | **Settings → Models → GitHub Copilot → Sign in** |
| Add or switch GitHub accounts | **Manage → Account management → Switch**; managed-only profiles |
| Select this Session's next-turn account | **Credits → Switch account**; saved authorizations only |
| Exclude or restore individual models | **Manage → Model preferences** |
| Choose models automatically | Pick **Auto · Balance**, **Auto · Efficiency** or **Auto · Intelligence** |
| Follow a parent model in supported subagents | **Plugins → dsh-github-copilot → Details → Follow parent model** |
| Choose primary/fallback search providers | **Plugin details → Web search** |
| Read account Credits and context evidence | Copilot Session composer; native Turn Usage stays separate |

![Current built Client account controls and model preferences](./docs/images/copilot-model-preferences.png)

Current alpha.130 built Client components in an isolated browser, with synthetic accounts and models. Manage contains account controls, continuation defaults and model preferences, including High cost. This is presentation evidence, not live sign-in, model availability or loaded Desktop proof.

![Switching between saved GitHub accounts in Models](./docs/images/copilot-accounts.png)

![Session account selection and account-wide quota in Credits](./docs/images/copilot-accounts-credits.png)

These captures use the same current built components and synthetic identities/quota. Models changes the global default; Credits changes only this Session's subsequent turns. They do not show real accounts or billing data. [Capture provenance](./docs/current-client-provenance.json).

## Install and sign in

Use the exact verified release, the intended profile and an authorized package source. No `copilot2api`, external gateway, pasted GitHub token, placeholder key or separate `dsh-web-search-provider` is required.

Before installation, extract the checksum-verified archive and run its **read-only composition preflight** with absolute paths:

```sh
node package/scripts/check-search-composition.mjs --profile-dir /absolute/profile --home /absolute/DSH_HOME --install-anchor /absolute/dsh/package.json
```

Supply any launcher patches with repeated `--patch /absolute/file`. Require `supported: true`: the install command does not automatically run this preflight. Unsupported/custom Web composition and `NONEMPTY_DISPOSABLE_PROFILE_ROOT` are stop conditions. Preserve a nonempty root and review whether public composition reconstructs it before any separately approved normalization; never assume it can be cleared. Check effective shared-peer resolution so stale profile-local packages do not shadow Desktop's official peers.

For a **standalone named profile**:

```sh
dsh plugin --profile web add https://github.com/cloga/dsh-github-copilot/releases/download/v0.4.0-alpha.130/dsh-github-copilot-0.4.0-alpha.130.tgz
```

For **Desktop**, its native package manager accepts `dsh-github-copilot@0.4.0-alpha.130` after publication. Official rc.2's **Desktop-bundled CLI** also supports reserved-profile plugin management; a global/generic `dsh` shim is not equivalent. Qualify the installed entry before use. See [Desktop CLI qualification](./docs/npm-distribution.md#desktop-bundled-cli-on-official-rc2) and the distinct [standalone offline procedure](./docs/npm-distribution.md#controlled-offline-cli-maintenance-for-standalone-profiles). Neither path authorizes registry-policy bypass, peer patches or configuration deletion.

After an approved reload/restart:

1. Open **Settings → Models → GitHub Copilot** and select **Sign in with GitHub**. No native provider or manual model definition is needed.
2. Copy the displayed one-time code and complete GitHub's device flow in your own browser. Desktop uses its system-browser handoff; a selectable verification URL remains available if it does not open.
3. Wait for **Signed in** and account discovery, then choose a model. Opening Models and normal use ensure missing/stale metadata; **Manage → Refresh models** is an intentional forced refresh, not routine setup.

Sign-out requires an explicit action and removes only the active account's authorization, not other saved grants or route settings. Upgrades preserve existing native Copilot profiles; two groups can remain until [explicit single-route migration](./docs/single-route-migration.md). Installation never migrates conversations or defaults.

In **Manage → Account management**, the **Switch** dropdown lists saved accounts and **Add GitHub account** at the bottom. Adding never replaces the global default. During device authorization, the card keeps the verification URL, one-time code, **Copy authorization code** and **Cancel adding account** together; identity/model verification follows separately. A confirmed switch changes future inherited turns, not running turns or explicit Session overrides. **Manage saved authorizations** contains **Reauthorize** and **Remove**; removal affects only a nondefault saved authorization, never a running turn's pinned account or GitHub-side access. **Refresh account information** updates identity, not authorization. Native-route or incomplete evidence blocks switching; missing/revoked accounts never fall back. A new account may lack your selected model, and encrypted replay may be account-bound: no automatic model substitution or history removal occurs. See [account requirements](./docs/copilot-accounts.md).

Completed managed turns show **Account** beside native Usage. It records the request account, not billing or subagent totals. A verified name is frozen at admission; if missing, an existing bounded non-forcing lookup for that exact account runs without delaying model delivery and can fill identity only while the same turn remains active. No account evidence exists before native delivery. Missing identity remains unavailable; completed history is never backfilled from current settings. Evidence is bounded to the Host lifetime; restart, cold history or missing delivery displays unknown. Credits labels an unidentified original or saved authorization without displaying opaque account IDs.

Saved account names can load without activating the account. Names are cached for the Host lifetime, invalidated by credential changes or failed verification, and never prove authorization or model access. A global switch requires fresh identity/model validation and confirmed settings persistence. If switching is blocked, let authorization or pinned work settle and use **Refresh account information**; unknown route/activity evidence remains a blocker. The dropdown, not a button beside each saved account, is the selection control.

**Desktop lifecycle:** disable/remove/upgrade can require a full cold restart for Web service recomposition. If the plugin is Off and the native manager reports only `pending (waiting for service: web)`, do not repeatedly toggle or reinstall. Obtain restart approval and follow [rc.2 lifecycle guidance](./docs/web-lifecycle-rc2.md).

## Auto and model preferences

**Saving preferences:** Exclude/Restore and High cost save immediately with confirmed settings readback. Other rows remain usable: up to 32 distinct-row edits can wait, marked **Waiting…**, while one is **Saving…**. An unconfirmed result or changed scope cancels unsent edits; **Retry** reads saved settings without replaying writes. The queue does not survive unmount.

**Provider-directory load failures:** native Models `llm/listProviders failed: Failed to fetch` is a Client-to-Host/gateway transport failure, not proof of forced Copilot discovery. Use the native page's **Retry** after the connection recovers; the plugin does not substitute a stale or empty catalog.

All three Auto preferences use the same account-verified, non-excluded eligible pool. Hard input/image capability checks run before soft task preferences.

| Task demand | Efficiency | Balance | Intelligence |
|---|---|---|---|
| Proven simple | Lightweight | Lightweight | Lightweight |
| Routine | Lightweight | Versatile | Powerful |
| Complex | Powerful | Powerful | Powerful |
| Unknown | Versatile | Versatile | Powerful |

Categories come from authenticated supplier metadata, not model names, context capacity or measured quality rankings. Within the first fitting category, positive cost weights and the finite continuity bonus described above choose the model; a suitable previous model is not unconditionally retained. Category fallback is explained explicitly. One real answer model stays fixed throughout each admitted turn's steps and retries; compaction preserves its independently resolved native summary route.

Semantic assessment is **enabled by default only for locally unknown tasks**. It makes at most one bounded auxiliary call with an **8-second end-to-end deadline** and **128-token output budget**. Set `github-copilot.autoSemanticAssessment: false` to opt out. Timeout/invalid output leaves demand unknown and uses the preference fallback; it never means simple or triggers another classifier. Caller cancellation and account invalidation remain terminal. Auxiliary calls add latency and supplier charges outside native answer Usage.

The deadline is checked against a monotonic clock at preparation, native request and result boundaries, even if the event loop delays the timer. Such delays can postpone settlement; they do not authorize late dispatch or late-result acceptance. Eligible Lightweight classifiers advertising reasoning `off` take precedence, with deterministic ID tie-breaking; the request uses `off` only if the public native model also supports it. This is not a measured speed ranking. Explanations distinguish the fitting category pool and previous-model continuity from semantic merit.

The reply's selection disclosure shows captured reasons and optional content-free auxiliary milestones. `uncertain` and `insufficient-evidence` do not mean the conversation is empty. **Selection unknown** means no retained record; **Selection unavailable → Retry** means the read failed. Retry rereads that turn, not inference. Evidence is bounded and Host-local, so restart/eviction can lose it.

When a failed/incomplete turn has no native Usage model row, the existing ⓘ opens **Turn model and selection evidence**: successful same-turn sources show **Recorded models** with incomplete failed-attempt attribution; reliable same-turn recorded request configuration shows **Requested model**, not dispatch, execution or billing proof. Missing evidence stays **Unknown**, never inferred from today's picker/default or adjacent turns. Selection reasons remain in a disclosure underneath. Complete native routes avoid repeated model UI; turns without a closing message have no existing assistant-actions entry. Native Usage and retries are unchanged. [Evidence boundaries](./docs/automatic-model-routing.md#attribution-and-explanation).

**Model exclusions** remove exact IDs from the managed picker and new Auto pools. Selected models are excludable: an admitted turn keeps its model, but a new turn/direct request cannot use an excluded ID. A fixed selection is never silently replaced. Unknown preference settings leave controls read-only, not falsely enabled. Saves use narrow native CAS without credentials, discovery or Session scans.

See [task assessment](./docs/auto-task-routing.md) and [routing contracts, exclusions and history recovery](./docs/automatic-model-routing.md).

Explicit Auto intent survives native pending-selection consumption and cold restore through a plugin-owned projection of existing selection events. Later explicit fixed choices still win for future turns; admitted turns keep their route. This does not backfill historical selection reasons or turn unknown evidence into guessed Auto.

## Subagents and search

![Current parent-following and Web search controls](./docs/images/copilot-search-routing.png)

Current alpha.130 built plugin-detail page with synthetic settings/providers and paused, empty diagnostics. No search, collection or live service was invoked for this capture.

**Follow parent model** defaults Off and applies profile-wide to supported native children/Team mates of managed Copilot parents. Fixed parents apply on each child's next turn; Auto parents pass the exact preference while each child evaluates its own context. Child-owned explicit selections win. Running turns, roots, forks, other providers and dedicated legacy policies are not rewritten. Existing legacy bindings remain independent when the broad switch is Off. [Parent-following contract](./docs/parent-model-follow.md).

**Web search** has two ordinary controls: primary provider and final fallback. Auto follows the initiating Chat provider when a corresponding search registration exists; fixed choices stay fixed when Chat changes. At most one distinct final fallback is tried, with possible charges disclosed. Cancellation/account-proof loss never authorizes a fallback.

Copilot search requires current account/protocol evidence and capability proof. Fixed/fallback Copilot preserves a nonempty legacy `searchModel`; otherwise it considers at most three account-owned Responses candidates. The final user query is sent once, never replayed across those candidates. A saved choice or successful Chat request does not prove hosted search. [Search routing and composition](./docs/session-search-routing.md).
The legacy `github-copilot.searchFallback` setting applies only to its separate
canonical inline path; it is not a third routed fallback. Fetch is unchanged.

## Usage, request limits and recovery

**Credits** shows validated account billing-cycle data, not context tokens or Session cost. Stale, pooled and unavailable readings keep their real meanings. The quota request alone uses Node plus system CA roots with TLS verification enabled; it does not change trust for sign-in, models, search or Desktop globally.

Native context occupancy and Turn Usage remain Core-owned. The plugin forwards usage unchanged, including zero samples on failure/cancellation. Ordinary in-progress requests and missing new samples stay quiet; only a concrete failed-zero or invalid-sample incident opens the separate, dismissible context warning. Any retained count is labeled historical evidence, never current occupancy or a replacement percentage. **Turn Usage incomplete** explains missing samples/lifecycle and recorded local blocks; it invents neither zero usage nor partial totals. Cancellation can retain usage, but does not guarantee a final supplier receipt. [Usage boundaries](./docs/copilot-usage.md).

Owned timeout/replay errors preserve native usage before terminal failure restoration, including nonzero samples. A failed zero can still make the native ring show `0%`; this is not proof of an empty request. Retry-entry times describe backoff, not the failed request's duration. These accounting fixes do not cure supplier HTTP 408 or change retry policy.

Compaction planning prices model-facing content and tools, not native IDs/provenance or opaque replay envelopes, avoiding metadata-driven exhaustion of the 16-call limit. The original messages/replay remain unchanged; final native admission still checks converted input. A typed capacity fallback keeps fixed prefixes and balanced tool units, never repeats an indivisible rejected input. This is conservative planning, not provider-exact token accounting.

Managed request admission preserves truthful input/output limits and native transactions. Automatic pressure uses the initiating Agent's actual bound compaction service; a preset without an engine cannot borrow global recovery. The separately selected [recovery engine](./docs/manual-compaction-recovery.md) defaults to automatic segmented fallback for oversized summaries or an explicit summary context-limit failure. Fitting summaries stay native; timeout/408/auth/quota failures do not trigger segmentation. Up to 16 calls may add time and charges; cancellation or incomplete recovery never commits a partial summary. `automaticRecovery: false` disables this fallback; native `auto: false` still disables automatic compaction. Installation alone does not select the engine: follow the explicit same-scope configuration migration, preserving preset/custom-engine ownership and existing policies.

For continuing steps with a committed managed route and no pending model change, known input pressure is reduced before Core opens the next model attempt. Successful native reduction avoids an unsampled local-pressure attempt that would make whole-turn Usage unavailable. First steps, pending selections, new fixed-prefix growth and final hard-budget refusals retain existing admission; this does not repair historical totals or invent missing usage.

**Visible-history continuation also covers this Session's native managed Responses compaction**, including automatic summaries: no extra manual recovery command or failure-first retry is required when enabled. Old encrypted reasoning and embedded summaries are omitted from outgoing input; hidden context may be lost. Visible messages/tool pairs and source history remain intact, and only the native transaction commits a smaller checkpoint. A composer notice identifies degradation and distinguishes committed, failed and cancelled outcomes. When off, an exact replay-scope rejection offers the same loss-disclosed enable control; unknown failures do not authorize loss. `/copilot-compact visible-history` remains a one-time alternative through the selected recovery engine. Read [recovery consent and limits](./docs/manual-compaction-recovery.md#explicit-visible-history-summary-recovery); this does not enable an absent engine or repair capacity, quota or timeout failures.

Compaction feedback separates **compaction completed** and **subsequent request succeeded** during the existing eight-second result window. It does not turn ordinary request progress or absence of a fresh sample into a persistent composer warning. A later concrete sampling incident can appear independently and may include a labeled historical count, but never an occupancy percentage. The plugin sends no extra test request, adds no retry and leaves the native context ring, Usage accounting and expandable compaction history unchanged. See [context evidence](./docs/copilot-usage.md#historical-context-evidence).

Running visible-history compaction notices stay visible. Confirmed success disappears eight seconds after first observation; settled failures, cancellation, unavailable status and enable prompts stay until **Close** (or the existing **Cancel**). Closing only hides this Session/operation/status notice, never changes consent, history or native proof, and never sends or retries. A bounded Client registration retains expiry/dismissal across incidental remounts and Session switches, not across teardown or eviction.

For exact verified `408 / user_request_timeout`, diagnostics describe bounded request composition and observable timing, not a proven payload limit or root cause. Image counts include native Responses tool outputs; older stored diagnostics may have counted those images as residual history. Bytes are not tokens; timing is not upload duration. Small, image-free requests can also time out. Follow [request-budget and timeout guidance](./docs/copilot-compaction.md); do not automatically trim history, disable proof, switch models or add retries.

The experimental `github-copilot.responsesRequestCompression` option is **off by default**. When explicitly enabled, it losslessly gzips only eligible managed HTTP Responses requests through the existing native Fetch seam. It starts at 256 KiB, skips compression work above 32 MiB and requires at least 5% and 4 KiB savings; every skip sends the original request. This changes prepared HTTP body bytes, not context/token admission. Custom Fetch, explicit `auto`/WebSocket and other protocols remain native, and a gzip rejection is never automatically resent uncompressed. On a verified 408, diagnostics distinguish original JSON composition from the prepared gzip body size; neither proves delivery or cures every timeout. Installation does not enable the option.

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
| `responsesRequestCompression` | `false` | Experimental lossless gzip for eligible managed HTTP Responses requests |
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
| AUTH, Responses replay-scope or TLS failure | Review [request diagnostics](./docs/model-compatibility-acceptance.md#authentication-replay-and-request-diagnostics) and [usage TLS boundaries](./docs/copilot-usage.md#account-data-boundary). After an exact scope rejection, **Replay recovery** shows the same persistent Session continuation policy: when off, disclose loss and offer **Enable visible-history continuation** or Cancel; when already on, show diagnostic guidance without repeated authorization. No duration or next-turn-only choice. Evidence expiry does not disable the policy. Use native Retry separately; no automatic send/retry or history rewrite, and not a 408 fix. Never reset credentials or disable TLS as an automatic repair. |
| Hosted search unavailable | Check account/protocol/probe diagnostics; a legacy override stays authoritative until explicitly reset |

Confirmed account saves restore controls immediately, independently of quota loading. Changing only follow mode for the same account retains its attributed quota without another read. Switching accounts clears the old quota and loads the new snapshot without blocking further account edits; quota errors do not undo a confirmed selection.

The Credits account panel shows the current account and **Switch account**. Its dropdown lists only configured accounts, marks the effective account and scrolls long lists internally. **Follow global default** is a separate checkbox: enabling it clears the Session override; disabling it fixes the current account. Choosing any account also fixes it, even if it is today's default. Both actions retain continuation confirmation and revision-checked saving. Account addition belongs only in Models, where one **Manage** disclosure contains account management and shared model preferences. Models retains Add in its dropdown footer without selecting the new account, plus guarded local removal and reauthorization. Neither surface has account search. Exact-ID exclusions are shared across accounts; availability is account-specific. See the [approved experience and interactive mock](./docs/account-management-experience.md).

[Visible-history continuation](./docs/session-continuation.md) is configured beside account switching, not permanently above the composer. New unseeded Sessions default on after the feature's first successful activation; existing Sessions and inherited histories remain off unless explicitly authorized. Global defaults affect new Sessions only; Session on/off overrides persist across accounts/restarts until disabled. With continuation off, a different-account switch offers persistent enable, keep off or cancel, without a one-turn mode. Each new enabled turn omits prior encrypted reasoning and embedded summaries, even on the same account; current-turn reasoning, visible messages, tools and disk history remain unchanged. Authorization never auto-sends/retries and is not a quota/context cure. Exact replay failures expose the same policy and require a separate native retry. The pinned Core lacks a public Models deep link; Chat omits the nonfunctional management entry. Full management remains in Settings → Models → GitHub Copilot → Manage.

Context evidence and Replay recovery use compact, centered notices bounded by the native composer width. Model/item counts and status refresh live in collapsed technical details; loss consent remains explicit. Context sampling warns only for a concrete incident, can be dismissed for that Session/incident, and never asserts the native meter's current value; native statistics stay unchanged. Switching accounts does not make old encrypted reasoning portable. The concise scope error points to explicit recovery or a new conversation; bounded, sanitized dispatch counts stay in Host diagnostics, not the main error. **Authorized** means permission is ready, not that a message was sent or recovery succeeded.

## Ownership and further reading

DSH Core owns Sessions, tools, sandboxing, attachments, native accounting and other providers. `llm-pi-ai` owns OAuth, token exchange/refresh and normal model transport. This plugin composes the published adapter with authenticated account metadata; new supported account model IDs need no name-based routing patch. Credentials stay Host-only: `llm-pi-ai/github-copilot` is the canonical compatibility record; additional accounts are independently authorized plugin-owned records in the same DSH credentials service, never copied grants.

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
curl -LO https://github.com/cloga/dsh-github-copilot/releases/download/v0.4.0-alpha.130/dsh-github-copilot-0.4.0-alpha.130.tgz
curl -LO https://github.com/cloga/dsh-github-copilot/releases/download/v0.4.0-alpha.130/SHA256SUMS
sha256sum --check SHA256SUMS
```

```powershell
$expected = (Get-Content .\SHA256SUMS).Split()[0]
$actual = (Get-FileHash .\dsh-github-copilot-0.4.0-alpha.130.tgz -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -cne $expected) { throw 'Release checksum mismatch' }
```

Checksums detect corruption/drift; protected workflows and repository controls establish publisher provenance. Report vulnerabilities privately through [SECURITY.md](./SECURITY.md).
