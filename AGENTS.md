# Agent guide

This file is the authoritative entry point for humans and coding agents. Read it before changing code.

## Plugin-only implementation boundary

This repository follows a **plugin-only** policy: implement fixes in `dsh-github-copilot` through existing published public Core/pi-ai APIs. This rule applies to agents, subagents, scripts, installers and release plans, not just the final diff.

- Do not edit DSH Core source, create Core implementation worktrees, prepare Core commits/PRs/releases, or rebuild/install a modified Core to complete this project's work.
- Do not patch deployed Core or dependency artifacts in `node_modules`, ship hidden Core patches, replace Core prototypes/private registries, or mutate shared upstream model catalogs. Create only plugin-owned objects and reversible registrations through public APIs.
- Do not make a Core patch, a new Core export, or an upstream Core PR being merged/released a prerequisite for delivering a plugin fix.
- Read-only Core/API inspection and isolated compatibility tests against unchanged pinned artifacts are allowed. Test-only fixtures must not alter tracked Core implementation or a live deployment and must clean up only their own temporary files. Historical controlled baselines are regression evidence, not permission for new Core changes.
- If the existing API cannot support the desired behavior, report the limit and choose a tested plugin-local alternative or defer that capability. Do not expand into Core work to preserve an earlier design claim. Reusing a published adapter class for an account-scoped, metadata-driven Copilot route is allowed; a second wire implementation, independently maintained static model catalog, copied credentials, or a fabricated single-route claim is not.
- General model compatibility must be data-driven: new account models with supported endpoint/capability metadata must work without adding model IDs or name-prefix branches to code. Unknown or incomplete metadata must produce a diagnostic rather than guessed capabilities. Follow [the current acceptance checklist](./docs/model-compatibility-acceptance.md), including Thinking, pi version compatibility, PR/merge/release and the requested local upgrade.
- Any future Core work requires a separate, explicit human request and separate task scope. Generic requests to fix compatibility, add models, optimize, or continue a goal do not grant that permission. Preserve abandoned Core work without resuming, publishing or deleting it automatically.

`agent-contract.json` records this boundary; `pnpm verify:agent` and tooling regressions reject missing or weakened policy. These checks detect repository policy drift, not filesystem access outside the repository; they do not replace agent compliance or sandbox enforcement.

## Agent quick start

1. Run `pwd`, `git status --short --branch`, and `git remote -v` in the bound checkout. Preserve user changes and existing worktrees; do not infer the project from the DSH installation path.
2. Read this file, then `node scripts/agent.mjs describe --json`. `agent-contract.json` maps each task to its owning files, focused tests, risks and approval boundaries; package scripts and release URLs are derived from current metadata.
3. Run `node scripts/agent.mjs doctor --json` before install. It is a dependency-free, read-only repository preflight: exit 0 means preflight passed, 1 means prerequisites missing, 2 means invalid arguments/metadata. Build presence is not build freshness, and no live DSH or credential readiness is claimed.
4. Choose a task with `node scripts/agent.mjs plan models --json` (or authorization/search/client/compatibility/tooling/release). Output is an unexecuted argv plan, never implicit permission to run destructive operations.
5. Use Node 24 LTS for development and the exact pnpm version in `package.json`; the runtime dependency floor is Node 22.19.0. Run frozen install in this checkout. Dependencies/build output are not carried into worktrees.
6. Create/reuse a tracking issue and feature branch, implement a regression first, run the full gate, inspect the diff, and open a PR. After an authorized merge of an important update, continue through the release-delivery rule below without another release prompt. Merge, live-profile install and worktree checkout still require explicit user approval.

Use native DSH tools for goals, background jobs and scoped subagents. Use local Git and the GitHub REST API for delivery; no external orchestration daemon, roster or `vcs_*` tool is required. Do not assume a model provider's identity is the assisting agent.

## Product and architecture

`dsh-github-copilot` is a companion targeting official DSH `0.1.6-alpha.2`, with retained baselines for DSH `0.1.6-alpha.1`, DSH `0.1.5-rc.2`, DSH `0.1.5-rc.1`, DSH `0.1.5-alpha.2`, DSH `0.1.5-alpha.1`, DSH `0.1.3-alpha.1`, DSH `0.1.2-rc.1`, and the controlled DSH Desktop `0.1.1-rc.2` Core baseline. It does not own a general Copilot chat adapter. DSH's built-in `llm-pi-ai` mount owns the GitHub Copilot provider, catalog, OAuth method and grant format, token exchange, refresh, and normal model transport.

This repository owns ten narrow surfaces:

1. A conditional authorization-service bootstrap plus Host controller that joins DSH authorization, credentials, and settings.
2. A Client Models provider-card contribution with one shared account-state owner and Client-safe Remote descriptors; embed in an existing configured canonical row, suppress its separate footer controller, and retain footer/old-Core section fallback when no such row is mounted.
3. Strict JSON normalization of pi-ai's provider-owned Copilot OAuth grant.
4. Preserve intentional absence of `llm-pi-ai.providers.github-copilot`; reconcile only existing legacy profiles and verified ownership journals. Fresh installations use the single account-discovered route; existing profiles require explicit migration, never silent removal.
5. Direct provider-hosted search using the same Host-side credential lifecycle.
6. Provider-scoped tool-schema compatibility for Copilot payload behaviors; Core remains the tool and execution owner.
7. A bounded account-discovery route that supplies validated endpoint/capability metadata to the published native adapter, without maintaining model-ID routing rules or changing Core's catalog.
8. Optional, provider-scoped Chat presentation for completed empty reasoning disclosures; durable content and encrypted replay metadata remain Core-owned.
9. Opt-in model-role settings and dedicated new planner/executor sessions, using public Agent/Session/subagent APIs without changing existing sessions, global defaults or native Subagent model-selection settings.
10. Managed-route estimated input/output admission, optional exact-request pressure signalling through official compaction recovery, and supported low summary effort only when no effort is already resolved. See [compaction budgets](./docs/copilot-compaction.md). Preserve truthful capacities, requested output caps, native errors/replay and transaction ownership; no hidden history trimming, chunking, new retry loop, competing compaction service or automatic model switch. Preventive guards do not claim recovery of an already oversized manual summary.

## Dedicated model-role boundary (#127)

`src/dual-model-host.ts`, `dual-model-types.ts`, `dual-model-remote.ts`, `dual-model-card.ts` and `dual-model-ui.ts` own this optional flow; see `docs/dual-model.md`. The three role Remotes use a separate namespace and strict codecs; the eight existing authorization/migration descriptors retain their original contracts. Policy is captured once per explicitly created root and restored through a namespaced projection. Account discovery and the native adapter remain the only model/auth owners. Dedicated tool restrictions are workflow controls, not a sandbox against shell code. Missing public seams must disable only this feature, never require a Core patch. A failed recovery of an existing create is uncertain: keep its request UUID unless Host evidence explicitly establishes not-created. Do not use `session.selectModel` to initialize roles because it also changes the future global default; the creation seed uses the existing session-local event format. Ordinary user model-picker actions remain Core-owned.

Alpha.25 admits native `subagent/descriptor` v3, already v3 in the retained rc.1 baseline; the old v1 assumption was a plugin/test bug. Projection cache `stateVersion: 2` forces refolding, not history conversion. Unknown/v1/v2 or invalid child descriptors fail closed unmodified; review the original child's work and explicitly create a new child if needed, never relabel or fabricate a descriptor. Strict Remote codecs provide alpha.2 `create()` factories and retain the legacy `schema` bridge to the same strict parser, with no `src-json` downgrade.

## File map

- `src/index.ts`: authorization bootstrap, dependency-gated Host entry, settings registration, listener, and `ctx.web` provider composition.
- `src/authorization-controller.ts`: sign-in/status/sign-out and route mutation.
- `src/copilot-grant.ts`, `src/copilot-auth.ts`: strict grant normalization and narrow pi-ai `CredentialStore` adapter over `llm-pi-ai/github-copilot`.
- `src/client.ts`: `settings.models.provider-card` account UI, a separate `settings.models.footer` search-routing card, and independently managed optional Chat integration.
- `src/web-search-routing-config.ts`, `src/web-search-routing-card.ts`: plugin-owned cross-provider live routing settings and the Models-page control surface.
- `src/reasoning-presentation.ts`: guarded native Chat delegation and historical Copilot provenance; filters temporary view props only, never messages, signatures, replay indexes or usage.
- `src/remote.ts`: Typert Remote contribution. Never add credential payloads here.
- `src/current-provider.ts`: selected DSH route plus installed pi-ai catalog facts.
- `src/temporary-models.ts`: exact, account-gated corrections with semantic protocol/capability retirement.
- `src/model-protocol.ts`: explicit Core capability detection and conservative legacy fallback.
- `src/responses-reasoning.ts`, `src/responses-reasoning-text.ts`: selected-model effort mapping and public summary assembly.
- `src/tool-schema-compat.ts`: Copilot-only prompt-assembly filter for unusable escalation arguments and action-specific Goal update schemas.
- `src/plan.ts`: Copilot-only, fail-closed hosted-search candidate lifecycle.
- `src/probe.ts`: bounded native-search capability proof.
- `src/wire.ts`, `src/wire-anthropic.ts`: inline hosted-search streaming.
- `src/traditional-search.ts`: `github-copilot-hosted` `ctx.web` provider.
- `src/serialize.ts`, `src/sse.ts`, `src/failure.ts`: protocol conversion and bounded error handling.
- `tests/`: unit and integration evidence; mirror the source area being changed.
- `deployment-baseline.json`: declared machine-readable compatibility and capability evidence inventory.
- `scripts/verify-deployment-baseline.mjs`: invariant drift gate.
- `lib/`: generated release output; never edit it.

## Non-negotiable invariants

- Do not implement a second general wire adapter or independently maintained static Copilot model catalog. The account-scoped route composes the published adapter and SDK with validated supplier metadata.
- Protocol and capability corrections must follow authenticated, current account metadata; new model IDs must not need new implementation tables. Native pi metadata may be reused only where it agrees with advertised endpoints and capabilities. Matching IDs alone do not prove correctness or authorize migration back into another Core catalog. Preserve old bounded ownership journals solely for verified restoration of legacy writes, never for new global protocol overrides.
- Solve protocol gaps inside the plugin using existing published extension points. Do not require a new Core capability/service or patch Core to keep a single route. The managed account-model route reuses the published adapter with one shared OAuth grant; label multiple routes honestly. Keep canonical Core models/configuration under their existing owner instead of rewriting them from the companion's pi catalog.
- Preserve public Responses summaries and the effective selected-model reasoning effort. Never synthesize raw reasoning replay from summaries or read/decrypt opaque replay data; assistant reasoning/replay histories delegate to Core before probing.
- Do not require or silently support `copilot2api`, an external gateway, a pasted GitHub token, a placeholder key, or `dsh-web-search-provider`.
- The credential record key is `llm-pi-ai/github-copilot`.
- OAuth credential payloads stay Host-only. Client Remote methods may expose status, notices, and errors only.
- Refresh must run through pi-ai `Models.getAuth()` and DSH `credentials.modifyRecord()`.
- Copilot OAuth grant writes must rebuild only pi-ai's documented provider fields as a fresh plain JSON object; unrelated extension values never reach DSH credential storage.
- Settings changes are path-level. Never replace the whole `llm-pi-ai` section or unrelated provider profiles.
- Sign-out deletes only the Copilot credential record and keeps route settings.
- Hosted search serves either an eligible initiating `github-copilot` / managed `github-copilot-preview` route, or provider-owned independent search selected by the web-search router. Independent search preserves a nonempty explicit `searchModel` override; otherwise the Host considers at most three eligible Responses models from current account route facts, in deterministic ID order, without a static model list. Metadata alone is not search proof, and the final user query is sent once after candidate proof, never replayed across models. Both paths require an account-available model and supported search protocol; custom inline transport remains legacy-canonical only. Never substitute the global chat default or another Session's identity. The default `probe: true` path requires successful capability proof; `probe: false` is an explicit trust override, not an implicit fallback. Any request containing a file block, including one nested in tool-result content, must bypass the custom wire through `next()` so Core retains file projection ownership.
- Misconfiguration and API drift fail loudly with a named missing seam. Do not fall back to process-local secrets or implicit machine state.
- Host, Client, and Remote package entries must stay independently buildable and exported.
- The package must self-provide authorization when Core omits it, reuse an existing service without duplicate registration, and never activate the integration body before authorization is available.

## Session and migration ownership (V3, alpha.8, #99)

- One global Host account supplies many models; selected/history-backed Sessions retain independent model context. Auto-mode native search derives from the captured initiating Session's effective request-header/config or explicit `GenerateOptions`, never another Session or future global default C. Fixed/fallback Copilot search uses the explicit provider-owned `searchModel` override when nonempty, otherwise bounded automatic account-owned Responses selection; it never borrows the Chat model, another Session's selection or the global chat default. `Agent.options` is the activation seed, not selected Session-model evidence; `installModelSelection` overrides request/assembly; Core records the effective `Session.requestHeader().config` before tools. Without proven request context, traditional search is unavailable. A newly selected pending model must not reuse the old request header as current prompt guidance. Per-owner plan caches prevent different-model A/B reuse/cancellation; metadata remains shared.
- The ordinary Web search card selects only the primary and fallback providers and saves both routing leaves in one namespace CAS. It must not depend on Copilot model discovery, a model selection or the Copilot settings namespace to save routing. Capture traced Settings/routing Remote faces once per UI registration so parent renders do not reset drafts. Preserve a legacy nonempty `searchModel` override; display it read-only and reset it only through an explicit, separate narrow CAS setting `searchModel: ''`, never as a routing-save side effect. Saving settings does not prove hosted-search capability.
- Cold Chat picker and `/model` `listModels()` ensure the shared managed source without Settings first. Actual cold managed search non-forcing ensures metadata before deriving facts; existing 24h maximum TTL, cooldown, credential, allowlist and capability/probe gates remain.
- Without `agents.currentInitiator`, traditional hosted search is unavailable with a named diagnostic; explicit marked `GenerateOptions` can still bind guarded inline requests, uncached if necessary. Credential notification during initial lazy discovery cannot distinguish own rotation from external account change via public status: fail closed with `WEB_PROVIDER_UNAVAILABLE` before probe/wire; a later user/driver request may retry, never automatically.
- The new native Copilot draft warning says Save adds another real group, not a second account. Public additive APIs cannot veto Add or disable Save; this is warning-only, not enforced single-route registration. Core Edit/Delete remain. Alpha.7 screenshots illustrate timestamps, not alpha.8 migration/search proof.
- Public `session.selectModel` also saves the future global default. Choose only approved Sessions/default; preserve other selected/history-backed Sessions, but do not promise unselected empty Sessions cannot inherit that default.
- Code does not auto-migrate settings, credentials or history. After plugin release, approved Ops migration may compare-and-swap only the reviewed user-native `llm-pi-ai.providers.github-copilot` path after ruling out base/journal conflicts, then read back settings and registry. No hidden groups, bulk rewrites or credential copying. Search allowlist updates to the managed ID require a separate reviewed Ops edit; never silently broaden old lists.

## Live migration readiness (alpha.9, #101)

- Use no-argument `githubCopilot.migrationStatus()` for fresh live-Agent evidence; generic `session/list` may be stale and plugin inventory alone has no loaded-version evidence. `src/migration-status.ts` reads public leaves synchronously and reports loaded build `plugin.name/version`, `protocolVersion: 1`, `observedAt`, capability flags and completeness flags. Missing/unknown/incomplete is not safe absence.
- Capabilities are `agentsList`, `sessionProjections`, `settingsCas`, `providerRegistry`, `defaultSelection`; `complete.sessions/defaultSelection/routes` describes evidence completeness, not migration approval. Effective selection uses pending projection, request-header config, then default only for genuinely empty Sessions with known projection state. Running `activeRequestSelection` is the latest recorded header, not proven in-flight LLM work. Native effective configuration and native/managed registration are separate flags.
- This read invokes no auth status/model discovery, credentials or network and mutates no settings/Sessions. No normal UI/global current-model/search card is added. Seven ordinary authorization Remotes retain their codec; the eighth migration Remote uses a separate strict `GitHubCopilotMigrationStatus` codec.
- `historyScope: live-agents-only` excludes cold stored histories. Require operator acknowledgement that older conversations may need a new explicit selection later. Loaded version/structural capability self-reports are not full Desktop/Core byte attestation or an atomic cross-namespace guarantee; recheck immediately before CAS.
- The planned `cloga/dsh-windows-ops` command `tools/migrate-copilot-managed-route.ps1` is separate config-only maintenance after release. V1 performs no automated Session/default writes, cold-history scan, plugin install, restart or full Desktop-baseline acceptance. Resolve selection blockers separately with explicit approval; never report this planned command or live migration as published/installed/completed without evidence.

## Supported DSH seams

The retained upstream baselines and current qualification target are:

- Desktop `0.1.1-rc.2` with controlled Core commit `a772dbbde82780bff2b9394427e9f0a24cafa1d5`
  on `cloga-pi-ai-model-api`, based on tag commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- Tag `dsh-v0.1.2-rc.1`, commit `a66e4702047846cdaa10c66c9d3df3951f5ea70d`.
- Tag `dsh-v0.1.3-alpha.1`, commit `d347e703908d0406b7a7ef80e3a0e594d86b2215`.
- Official tag `dsh-v0.1.5-alpha.1`, commit `5dda764ed3aa172535a7967b06ff95d9cbfe536a`.
- Official tag `dsh-v0.1.5-alpha.2`, commit `b2e3b2a0125854567a4a5fcba75782e42fe84901`.
- Official tag `dsh-v0.1.5-rc.1`, commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`.
- Official tag `dsh-v0.1.5-rc.2`, commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`.
- Official tag `dsh-v0.1.6-alpha.1`, commit `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`.
- Official tag `dsh-v0.1.6-alpha.2`, commit `ddefc45fbc7f8e46dd73185e68295696d1297887`.

The current qualification target is official `0.1.6-alpha.2`; retain all eight earlier pins (nine total) and exact `0.1.2-rc.1` development dependencies. All seven tagged-source targets use unchanged tagged-source runtime fixtures, not standalone npm-artifact certification. The 0.1.6 fixture must await serialized `agent/created`, avoid new synchronous Session-history reads, and verify MCP resource cursors, PTC/workflow names, cancellable Sandbox/Shell preparation, optional-plugin startup policy, attachment cache separation, durable `IMAGE_OFFLOAD_REQUIRED` projection/retry and Team pagination without taking ownership of those services. Compatibility metadata and synthetic tests do not prove live endpoints, installed Desktop bytes, release publication or loaded runtime state. Public Host, Client and Remote seams remain available; this baseline update does not authorize implementation rewrites.

These pins document compatibility evidence. They do not authorize creating another controlled Core patch or making one a prerequisite for new plugin fixes.

- Models UI: `0.1.2-rc.1`, `0.1.3-alpha.1`, `0.1.5-alpha.1`, `0.1.5-alpha.2`, `0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.6-alpha.1` and `0.1.6-alpha.2` expose `settings.models.provider-card`, keyed by settings namespace `llm-pi-ai`, to embed login/status/Refresh/Manage in a mounted configured canonical `github-copilot` row and suppress the separate footer controller. With no such row mounted, retain footer fallback; rc.2 uses a dedicated `settings.section`. Preserve the shared account-state owner across transfer only while another eligible surface remains mounted. Unmounting the last surface or replacing declarations without overlapping mounts stops polling; a later controller reads status and separately non-forcing ensures missing/idle/stale/error/loading signed-in metadata, without replaying the old forced-login action. Manual Refresh models lives inside Manage; errors expose Retry. Opening Models is no longer guaranteed network-free, but status/details themselves remain pure. This additive slot cannot replace Core Edit/Delete: retain the native editor, while normal plugin discovery needs no manual model definitions. UI integration must not merge/remove actual canonical and `github-copilot-preview` routes or rewrite credentials, configuration, history or selection.
- Authorization flow key: `llm-pi-ai/github-copilot`.
- Authorization service: rc.1 Core provides it; the rc.2 web/headless profiles rely on this package's runtime dependency and conditional bootstrap.
- Credentials: use record description/read/modify/delete APIs on the Host. Never read records in the browser.
- Copilot grant schema: `type: oauth`, non-empty `refresh`/`access`, finite `expires`, optional non-empty `enterpriseUrl`, and optional deduplicated non-empty-string `availableModelIds`.
- Settings: never recreate a missing `providers.github-copilot` profile. Existing native profiles remain user/Core-owned and require explicit migration before only the account-discovered route is listed.
- Per-model API: do not assume stock Core honors a configured model.api. Verify the existing published behavior; where it cannot serve a model, use a plugin-local, exact-model alternative or report the limitation rather than patching Core.
- Route activation: the dormant `llm-pi-ai` mount observes the profile and registers the route.
- Client activation: package metadata injects DSH remotes and Models UI; `./client` mounts `./remote`.
- Provider headers: rc.1 validates configured headers through Fetch and reuses Host-owned headers during model discovery.
- Remote results: the seven ordinary authorization methods retain the Zod v4 `GitHubCopilotAuthorizationView` strict codec required by rc.2 and accepted by rc.1. The eighth no-argument `migrationStatus()` method has a separate strict `GitHubCopilotMigrationStatus` codec; it does not change the ordinary auth contract.

When upgrading DSH or pi-ai, inspect the exact tagged public exports and update the baseline, compatibility guard, tests, and docs together. Apply the **official-first policy**: compare each customization's purpose against exact official source/contracts, classify complete/partial/unverified support, choose retain/migrate/retire, and record the remaining gap plus a concrete retirement trigger. Unverified parity is not evidence of absence. Prefer official behavior only after configuration/data migration, safety and runtime acceptance are reviewed; remove redundant paths and their obsolete tests without losing user-visible acceptance coverage. The current comparison is [official-first alpha.2](./docs/official-first-016-alpha2.md).

For alpha.25, source markers, local rc.1-backed focused tests and fifteen scoped exact-source runtime tests passed (alpha.2 contracts 8, Remote 1 and Session-context 6). Full local `pnpm verify` passed: 1373 Vitest tests with 2 expected skips, 176 tooling tests, typechecks, build and package smoke; pack/tarball verification passed. The scoped tests use a supplemental resolver with official TypeScript `6.0.3`, declared `mime-types@3.0.2` and `ws@8.21.0`, and shared Zod `^4.4.3`, without source/dependency patches, not the full official-root-helper closure. Broad frozen dependency installation is blocked by the configured mirror's HTTP 404 for `node-addon-require-builtin@0.1.6`, and candidate CI qualification has not executed. Keep these limits separate from live Desktop, published-artifact, OAuth and model-call compatibility; none is claimed.

## Code and documentation conventions

- TypeScript is strict, ESM, and English-only for code, comments, test names, and `README.md`.
- `README.zh.md` is the Chinese user guide and should match the English product contract.
- Prefer existing helpers and narrow interfaces over casts or broad catches.
- Provider/network errors must not leak credentials or raw sensitive response bodies.
- Do not commit generated archives, temporary files, `.env` files, tokens, or local credentials.
- Keep design rationale in code/docs that enforce it; do not add empty templates or duplicate policy documents.

## Distribution and release invariants

- GitHub Releases and npm are the default distribution channels for every new version. This supersedes the Release-only decision in #43 at the user's request. Publish the same verified original tarball to both; never repack an existing release or silently skip npm. The initial package bootstrap is complete; subsequent publication requires the configured OIDC Trusted Publisher. Registry readback may lag a successful write, so uncertain outcomes must reconcile exact existing bytes after visibility converges and must never trigger an automatic republish. See [npm distribution](./docs/npm-distribution.md). Never bypass organizational registry restrictions.
- User-facing install commands must include the required DSH `--profile` option and derive the versioned Release URL from `package.json`.
- Package version, deployment-baseline version, README URLs, and the annotated `v<version>` tag must agree.
- New versions use standard SemVer prerelease identifiers (`alpha`, `beta`, `rc`); do not add owner/user names to new version strings.
- The Release workflow must run the complete gate, pack the versioned tarball, publish `SHA256SUMS`, and create the Release only after every preceding step succeeds.
- Release tags must never move or be reused. Repository tag rules and immutable-release settings enforce this for new releases.

## Important-update release delivery

- User-requested important updates include user-visible features, behavior fixes, compatibility fixes, and security or stability fixes. Their default delivery includes publication after an authorized merge and green required CI; do not stop at a merged PR or ask a second time whether to release.
- Explicit user restrictions such as code-only, review-only or do-not-release take precedence. Pure documentation and internal-only changes are not automatically release-bearing; they need an explicit release request if publication is desired. A task plan is not permission for an unrelated release.
- Plan version alignment with the implementation PR whenever possible. If the prepared version/tag is unused and aligned, release it; otherwise prepare the next appropriate SemVer version through the normal PR path. Preserve the prerelease channel unless promotion is explicitly requested. Any additional version PR still needs merge approval, not a repeated release-scope question.
- Check all required CI, tag rules and package/archive checks. Create a fresh annotated tag only on the verified merged revision, let the protected Release workflow publish, and verify the non-draft Release, intended prerelease flag, tag/commit, assets and SHA-256. Never bypass failing CI, move a tag or substitute an unverified local archive.
- A release-bearing update is not fully delivered until the published Release URL, verified version/commit/assets/checksum and npm version/SRI are reported. If CI, permissions or network prevents either channel, report partial delivery and the exact pending step; never describe merged-only or GitHub-only work as fully delivered.
- This standing release authorization does not authorize profile installation, sign-out, worktree checkout or interruption of running Sessions. Keep published, installed-on-disk and loaded-runtime status separate; a session-interrupting restart still requires explicit acknowledgement.

## Installation-agent PowerShell practice

Installation agents using the DSH `pwsh` tool must follow these rules:

- Initial `pwsh` calls omit `sandbox_permissions` and `justification` entirely.
- When approval prompts are disabled, never include either field.
- When the current sandbox mode is `danger-full-access`, never request escalation.
- Use both fields only once, when retrying the exact same command after a real sandbox denial, approval is available, and the target mode is strictly wider than the current mode.
- Omit the keys rather than sending `null`, empty strings, or the current sandbox mode.

The plugin keeps its managed Copilot route on ordinary JSON-schema tool calling and removes `sandbox_permissions` plus `justification` only from tool schemas assembled for the `github-copilot` provider. Optional schema semantics alone do not stop these models from emitting invalid escalation requests. Other providers retain the native one-shot escalation surface; Copilot sessions must choose sufficient standing permissions before a call that needs wider access. The rules above remain agent-side practice, and the plugin does not rewrite user-global agent instructions.

## Mechanical verification

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
```

Then run `pnpm verify:tarball -- artifacts/dsh-github-copilot-<package-version>.tgz` on that exact archive. `node scripts/agent.mjs plan release --json` supplies the versioned argument without shell interpolation or platform assumptions.

`pnpm verify` checks the Agent contract, source and local test types, baseline markers, a clean build, Vitest tests, Node tooling tests, and real built Host import/Client-loader/Remote smoke. `tests/fixtures` are intentionally excluded from local test typecheck because they import source from a separate pinned Core checkout. The checked-in code must pass; never suppress compiler errors or weaken a test to get a green report.

The CI definition targets Windows/Linux against all nine exact Core baselines, with unchanged tagged-source runtime checks for all seven tagged-source targets: `0.1.3-alpha.1`, `0.1.5-alpha.1`, `0.1.5-alpha.2`, `0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.6-alpha.1` and `0.1.6-alpha.2`. Optional native Chat fixtures also cover all seven tagged-source targets and `0.1.2-rc.1`. This is a required gate, not evidence that alpha.25 qualification has executed. `verify:upstream` is static seam-marker evidence. `verify:controlled-core` exclusively installs a temporary config fixture, refuses an existing target, and removes only its own file; it is not full plugin activation. The published rc.2 adapter test covers model materialization, not live provider transport. The release job must wait for the complete reusable CI matrix on the tagged revision, then verify its own packed bytes before publishing.

### Evidence and side effects

| Operation | What it proves / changes |
|---|---|
| `agent.mjs describe/doctor/plan` | Read-only checkout metadata/preflight; never runtime health or credentials |
| `pnpm verify:baseline` | Required source/test markers exist; not semantic or live proof |
| `pnpm verify` | Local compiler, tests, clean build and import checks; no real OAuth/API requests |
| `pnpm verify:tarball` | Archive structure/export/media and equality to local build; no extraction/execution |
| Authorization `status()` / `describeGitHubCopilotProviderProfile()` | Read-only grant snapshot and route planning; no settings mutation, OAuth refresh or network proof |
| Authorization `reconcile()` / `inspectGitHubCopilotProviderProfile()` | Explicit stored-snapshot repair; revision-checked settings writes; NOT token/model discovery refresh |
| Explicit UI Start sign-in / account switch | Successful immediate or polled completion forces one bounded discovery; shared owner survives only overlapping eligible mounts; no model switch or message replay |
| Models opening / `ensureModels()` | Separately ensures missing/idle/stale/error/loading signed-in metadata once without force; error re-entry may retry after shared cooldown with no same-mount loop; loading joins the Host flight without extra network; fresh ready makes no request and true unavailable/empty models do not auto-retry; status/details remain network-free |
| Manage → Refresh models / visible Retry | Explicit bounded discovery and native OAuth refresh when needed; not a prerequisite for normal opening/use |
| Metadata freshness | `github-copilot.accountModelTtlMs` defaults to 86400000 (24h maximum reuse); `accountModelFailureCooldownMs` defaults to 300000 (5min non-forcing failure cooldown); shared Host single flight, no periodic metadata polling; a separate mounted 60s timer updates timestamp text only |
| Last metadata display | Same-account data may display during TTL refresh/loading/error but never authorize requests; credential/account/permission invalidation or proof expiry immediately revokes evidence; TTL does not extend tokens |
| Last-success timestamp (alpha.7, #97) | Show `snapshot.discoveredAt` once beside count outside Manage: English relative text, full LOCAL date/time/zone tooltip and accessible semantic `time`; missing/invalid/no account hides it, future uses absolute text. Pending/error retains last success, successful refresh replaces it and sign-out clears it. One mounted 60s display-only timer makes no RPC/status/discovery calls and is disposed with timestamp/unmount; cache/discovery lifecycle unchanged |
| Definitive `UNKNOWN_MODEL` | One bounded metadata refresh, never message replay or automatic model switching; generic HTTP/network errors are not guessed to be unknown models |
| README GIF/PNG illustrations | Primary alpha.7 model-freshness/model-refreshing PNGs show the built Client in isolated Edge with synthetic Remote/provider shell. Fake-clock checks advance the label from 8 to 10 minutes without additional RPC, retain timestamp during pending/error, replace it on refresh success, clear it and remove the timer on sign-out, and keep the 375px layout safe. Host TTL/cooldown timing needs unit tests, not screenshots; no live Core/production authorization. Provider-entry/authorization PNGs remain historical alpha.5; older compact GIF/PNGs alpha.3 |
| Host attach/restart | Reconciles the stored profile; search proofs stay lazy and do not start at attach |
| Background credential/reset notifications | Invalidate evidence and clear Client state with read-only status; no forced discovery on every token event; next Models open/use ensures metadata |
| Eligible model/search request | May resolve/refresh credentials and run bounded capability proof; changes during proof must fail closed rather than reuse another account's proof |
| Release install | Writes a named user profile; installed on disk is not loaded in the running Host |

Never say GPT-6/search works merely because settings, typecheck or a package import passes. Report the layers separately. Keep synthetic credentials in fixtures; no real sign-in, logout or API call just to produce test evidence. Do not recommend disabling capability proof as a routine repair. Preserve logs locally and report only redacted facts; route security-sensitive findings through SECURITY.md.

## Changing capabilities

1. Identify the owning seam using `agent-contract.json`; do not duplicate an upstream owner.
2. Add or update focused tests before changing deployment claims.
3. Update both READMEs when user behavior, setup, migration, or boundaries change.
4. Update `deployment-baseline.json`, `agent-contract.json` and their verifiers when the corresponding contract changes.
5. Build before package smoke; never hand-edit `lib/`.

## Issue, branch, and PR workflow

- Every change starts from a tracking issue. Resolve the actual default branch through Git remote metadata.
- Work on a feature branch; never commit directly to `main`.
- Reference the issue in the commit and use truthful tool attribution: `Assisted-by: DeepSeek Harness (DSH)` for this DSH session. For a different tool, name the tool actually used. `node scripts/agent.mjs attribution "DeepSeek Harness (DSH)"` formats the trailer without inventing an identity.
- `Co-authored-by` is reserved for actual collaborators with verified identities. Do not copy the Copilot App trailer from history or invent a bot email. The model provider is not the authoring tool. Keep the user's Git author unchanged and do not rewrite published history.
- State expected results and scope before the complete gate; compare actual outcomes before pushing. All current CI checks must be green before any authorized merge.
- Push only the feature branch and open a PR targeting the resolved default branch with `Fixes #<issue>`. Include risks, tests, evidence limits, and rollback.
- Merge, installing into a user profile, sign-out and worktree checkout require explicit user approval. Important-update publication follows the standing release-delivery rule above, not a second release prompt; other releases need an explicit request. Never bypass branch/tag protection.

GitHub operations must use the repository owner's intended authenticated identity. Inject credentials only into the current Git/API process; never print or persist them or add machine-specific credential paths here. Network failure is not an authentication failure: follow user-authorized network recovery, bound retries, preserve local work and report pending remote delivery honestly.
