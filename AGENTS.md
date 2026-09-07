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

`dsh-github-copilot` is a companion to DSH `0.1.3-alpha.1`, DSH `0.1.2-rc.1`, and the controlled DSH Desktop `0.1.1-rc.2` Core baseline. It does not own a general Copilot chat adapter. DSH's built-in `llm-pi-ai` mount owns the GitHub Copilot provider, catalog, OAuth method and grant format, token exchange, refresh, and normal model transport.

This repository owns eight narrow surfaces:

1. A conditional authorization-service bootstrap plus Host controller that joins DSH authorization, credentials, and settings.
2. A Client Models provider-card contribution and Client-safe Remote descriptors.
3. Strict JSON normalization of pi-ai's provider-owned Copilot OAuth grant.
4. Reference-free creation of a missing `llm-pi-ai.providers.github-copilot` profile plus leaf-only reconciliation of existing profiles.
5. Direct provider-hosted search using the same Host-side credential lifecycle.
6. Provider-scoped tool-schema compatibility for Copilot payload behaviors; Core remains the tool and execution owner.
7. A bounded account-discovery route that supplies validated endpoint/capability metadata to the published native adapter, without maintaining model-ID routing rules or changing Core's catalog.
8. Optional, provider-scoped Chat presentation for completed empty reasoning disclosures; durable content and encrypted replay metadata remain Core-owned.

## File map

- `src/index.ts`: authorization bootstrap, dependency-gated Host entry, settings registration, listener, and `ctx.web` provider composition.
- `src/authorization-controller.ts`: sign-in/status/sign-out and route mutation.
- `src/copilot-grant.ts`, `src/copilot-auth.ts`: strict grant normalization and narrow pi-ai `CredentialStore` adapter over `llm-pi-ai/github-copilot`.
- `src/client.ts`: `settings.models.provider-card` UI keyed by `llm-pi-ai` and independently managed optional Chat integration.
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
- Hosted search only serves the selected `github-copilot` route for an account-available model and a native search protocol. The default `probe: true` path requires successful capability proof; `probe: false` is an explicit trust override, not an implicit fallback. Any request containing a file block, including one nested in tool-result content, must bypass the custom wire through `next()` so Core retains file projection ownership.
- Misconfiguration and API drift fail loudly with a named missing seam. Do not fall back to process-local secrets or implicit machine state.
- Host, Client, and Remote package entries must stay independently buildable and exported.
- The package must self-provide authorization when Core omits it, reuse an existing service without duplicate registration, and never activate the integration body before authorization is available.

## Supported DSH seams

The supported upstream baselines are:

- Desktop `0.1.1-rc.2` with controlled Core commit `a772dbbde82780bff2b9394427e9f0a24cafa1d5`
  on `cloga-pi-ai-model-api`, based on tag commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- Tag `dsh-v0.1.2-rc.1`, commit `a66e4702047846cdaa10c66c9d3df3951f5ea70d`.
- Tag `dsh-v0.1.3-alpha.1`, commit `d347e703908d0406b7a7ef80e3a0e594d86b2215`.

These pins document compatibility evidence. They do not authorize creating another controlled Core patch or making one a prerequisite for new plugin fixes.

- Models UI: rc.1 and alpha.1 use `settings.models.provider-card`, keyed by settings namespace `llm-pi-ai`; rc.2 falls back to a dedicated `settings.section`.
- Authorization flow key: `llm-pi-ai/github-copilot`.
- Authorization service: rc.1 Core provides it; the rc.2 web/headless profiles rely on this package's runtime dependency and conditional bootstrap.
- Credentials: use record description/read/modify/delete APIs on the Host. Never read records in the browser.
- Copilot grant schema: `type: oauth`, non-empty `refresh`/`access`, finite `expires`, optional non-empty `enterpriseUrl`, and optional deduplicated non-empty-string `availableModelIds`.
- Settings: create the provider through a path operation at `providers.github-copilot`.
- Per-model API: do not assume stock Core honors a configured model.api. Verify the existing published behavior; where it cannot serve a model, use a plugin-local, exact-model alternative or report the limitation rather than patching Core.
- Route activation: the dormant `llm-pi-ai` mount observes the profile and registers the route.
- Client activation: package metadata injects DSH remotes and Models UI; `./client` mounts `./remote`.
- Provider headers: rc.1 validates configured headers through Fetch and reuses Host-owned headers during model discovery.
- Remote results: all authorization methods share the Zod v4 `GitHubCopilotAuthorizationView` strict codec required by rc.2 and accepted by rc.1.

When upgrading DSH or pi-ai, inspect the exact tagged public exports and update the baseline, compatibility guard, tests, and docs together.

## Code and documentation conventions

- TypeScript is strict, ESM, and English-only for code, comments, test names, and `README.md`.
- `README.zh.md` is the Chinese user guide and should match the English product contract.
- Prefer existing helpers and narrow interfaces over casts or broad catches.
- Provider/network errors must not leak credentials or raw sensitive response bodies.
- Do not commit generated archives, temporary files, `.env` files, tokens, or local credentials.
- Keep design rationale in code/docs that enforce it; do not add empty templates or duplicate policy documents.

## Distribution and release invariants

- GitHub Releases are the only distribution channel; `package.json` stays private and npm publishing must not return.
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
- A release-bearing update is not fully delivered until the published Release URL and verified version/commit/assets/checksum are reported. If CI, permissions or network prevents release, report the concrete blocker and the exact pending step; never describe merged-only work as released.
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

CI runs on Windows/Linux against the three exact Core baselines. `verify:upstream` is static seam-marker evidence. `verify:controlled-core` exclusively installs a temporary config fixture, refuses an existing target, and removes only its own file; it is not full plugin activation. The published rc.2 adapter test covers model materialization, not live provider transport. The release job must wait for the complete reusable CI matrix on the tagged revision, then verify its own packed bytes before publishing.

### Evidence and side effects

| Operation | What it proves / changes |
|---|---|
| `agent.mjs describe/doctor/plan` | Read-only checkout metadata/preflight; never runtime health or credentials |
| `pnpm verify:baseline` | Required source/test markers exist; not semantic or live proof |
| `pnpm verify` | Local compiler, tests, clean build and import checks; no real OAuth/API requests |
| `pnpm verify:tarball` | Archive structure/export/media and equality to local build; no extraction/execution |
| Authorization `status()` / `describeGitHubCopilotProviderProfile()` | Read-only grant snapshot and route planning; no settings mutation, OAuth refresh or network proof |
| Authorization `reconcile()` / `inspectGitHubCopilotProviderProfile()` | Explicit stored-snapshot repair; revision-checked settings writes; NOT token/model discovery refresh |
| Host attach/restart | Reconciles the stored profile; search proofs stay lazy and do not start at attach |
| Credential/settings notifications | Invalidate cached proof only; no eager authenticated/network calls |
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
