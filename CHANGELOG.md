# Changelog

## 0.4.0-alpha.35 (prepared)

- Match the account-usage control to native secondary statistics typography, line height and pill spacing (#160).
- Keep its label on one line within the host's available width, with ellipsis and a full-label tooltip for constrained layouts; independent details, focus and account-wide billing semantics remain unchanged.
- Remove the permanently unavailable Session credits section. Hide missing, malformed, zero or elapsed reset metadata instead of displaying the Unix epoch; prefer a valid snapshot reset, then a valid account-level date, without inventing dates or discarding otherwise valid quota amounts.
- Continue using the existing additive composer dock. Shared-row placement and responsive wrapping belong to the host layout; no private DOM relocation, native statistics replacement or new Core API dependency is introduced by this plugin.
- Preserve alpha.34's Model roles retirement and compatibility-only historical Session behavior. This presentation update does not install, activate or restart a profile.

## 0.4.0-alpha.34 (prepared, PR-only)

- Retire the Model roles / planner-executor settings, legacy Settings fallback, and dedicated-session creation UI (#158); ordinary Sessions and Core-owned subagents remain the intended workflow.
- Remove obsolete role Client components and browser fixtures, with negative registration and adjacent account/search/usage regressions.
- Keep existing dedicated-session policy replay and strict Remote contracts for compatibility; reject role configuration writes and new dedicated roots explicitly, retaining evidence-only recovery of matching existing requests.
- Do not migrate or delete saved settings, histories, credentials, model choices or global defaults. Native parent-to-child model rules remain separately pending Core work, not a capability supplied by this retirement.
- Version metadata prepares the required PR release gate only; merge, publication, installation and activation are not part of this PR-only request.

## 0.4.0-alpha.33 (prepared)

- Fix the account-usage composer component to call the public `useSession(selector)` hook with a selector instead of assuming a no-argument snapshot API (#156).
- Preserve native Session ownership and select only the open/current/not-removed predicate; no Core patch, credential change, network-policy change or automatic restart is required.
- Add positive canonical/managed Copilot rendering and required-selector lifecycle regressions. Earlier signed-out absence tests do not establish that the eligible-session control can render.

## 0.4.0-alpha.32 (prepared)

- Add an optional, Copilot-session-scoped composer usage control without replacing the native Context meter or changing other providers (#153).
- Read bounded account quota snapshots through the canonical Host-owned OAuth grant and a separate strict usage Remote namespace; preserve the existing authorization contracts.
- Distinguish AI credits, legacy premium requests, individual budgets, shared pools, unavailable data and last-known snapshots. Never invent remaining credits from missing metadata, token estimates or another session.
- Keep per-session credits explicitly unavailable until a supported public native accounting seam exposes complete provider-reported usage; no second model transport, Core patch, live-profile installation or restart is included.

## 0.4.0-alpha.31 (prepared)

- Retire the exact current managed-route token proof after an observed model HTTP 401, preserving the native failure without replay, logout or model switching (#152).
- Let the next independent caller renew a rejected token through native `Models.getAuth()` and the serialized canonical credential store, even if its stored expiry is still in the future. Never persist a projected expiration or replace a newer sign-in.
- Bound recovery per account using the existing cooldown setting (five minutes by default, one-second floor); reject identical-token renewal and ignore late generations, 403, cancellation and error strings without an observed HTTP response.
- Cover sign-out/sign-in with retained conversation history, native HTTP transports, concurrent renewal, credential races and cooldown. Synthetic evidence does not prove the original endpoint rejection cause, live OAuth/model acceptance, WebSocket recovery, publication or Desktop activation.

## 0.4.0-alpha.30 (prepared)

- Route verification links on recognized Desktop v1 hosts through the existing same-window external-navigation handoff instead of popup creation; retain new tabs on web hosts (#150).
- Display a selectable verification address for manual browser handoff without claiming that the system browser opened or authorization succeeded.
- Remove the Compatibility and existing configurations disclosure from Manage. Preserve legacy configuration diagnostics, explicit repair, migration documentation, credentials and session behavior.
- Cover Desktop/web targets, manual URL handoff and expanded Manage across account states. Synthetic Client evidence does not establish live Desktop activation or OAuth success.

## 0.4.0-alpha.29 (prepared)

- Fix search settings drafts and pending saves being reset by parent renders: capture stable traced Settings/routing Remote faces once per registration (#148).
- Make ordinary Web search settings provider-only, rename the final default to Fallback provider, and save both routing choices in one namespace CAS without model discovery or a model prerequisite.
- Resolve independent Copilot search models from current account-owned Responses metadata in deterministic order, with at most three capability-probed candidates and one final query. Preserve allowlists, explicit overrides, account/owner proof, cancellation and fallback policy; never borrow a Chat/global default or hardcode model IDs.
- Preserve existing model overrides and offer a separate explicit reset to automatic selection. Classify safe save/conflict diagnostics without exposing raw Remote errors.
- Add real pinned Settings/Client-codec contracts, mounted React/Cordis lifecycle tests, and isolated built-browser before/after reproduction. These are not live OAuth/search, published-release or installed Desktop acceptance claims.

## 0.4.0-alpha.28 (prepared)

- Enforce plugin-owned estimated independent prompt and combined input/output budgets on the managed Copilot route while preserving advertised context capacity and native transport (#146).
- Signal eligible exact-session loop pressure before model dispatch through the existing official bounded compaction/rebuild path; respect disabled automatic recovery, model-specific zero retries and cancellation.
- Prefer supported minimal/low reasoning only for compaction with no supplied or materialized effort, without silently rewriting the requested summary output cap or changing ordinary conversations.
- Preserve structured local admission failures through SDK wrapping, current system/tool accounting, concurrent-call isolation and distinct output-truncation outcomes. Add configurable safety/pressure/summary policy and regression coverage.
- Keep already oversized manual summaries as explicit failures; this release does not claim chunked recovery, silent history deletion, automatic model switching, Core changes or local Desktop activation.

## 0.4.0-alpha.27 (prepared)

- Remove the separate Model roles workspace dropdown: role settings remain profile-global and saving does not require a workspace (#144).
- Show the current workspace read-only for explicit dedicated-session creation, observing public Client lists on both legacy selection and alpha.2 main-view ownership. Missing or ambiguous selection disables creation rather than choosing a first/recent workspace.
- Retain one traced Remote face per UI registration so navigation preserves drafts and uncertain-create UUID/workspace/revision across footer/fallback remounts. Ordinary and existing sessions remain unchanged.
- Add mounted Cordis/React and current-workspace regressions without changing Core, dependencies, Host codecs or session policy.

## 0.4.0-alpha.26 (prepared)

- Fix low-contrast native dropdown options in dark mode for planning/execution models, workspaces and search providers (#142).
- Pair opaque application-theme surfaces with primary or secondary foreground tokens on both selects and options, with readable system-color fallbacks on hosts without those tokens.
- Preserve disabled/unavailable choices and all selection, CAS and session behavior. Add focused regressions and remove fixture-only option colors that masked the production bug; no Core or dependency changes are required.

## 0.4.0-alpha.25 (candidate)

- Append the ninth exact official target `dsh-v0.1.6-alpha.2` at `ddefc45fbc7f8e46dd73185e68295696d1297887`, retaining all older pins and exact `0.1.2-rc.1` development dependencies.
- Supply strict Remote `create()` factories with a legacy `schema` bridge over the same parser; preserve endpoint contracts and validation rather than weakening to `src-json`.
- Correct dedicated executor projection admission to native `subagent/descriptor` v3. Native descriptors were already v3 in rc.1; the plugin's old v1 assumption was a bug, not an upstream format migration.
- Bump the plugin projection cache to `stateVersion: 2` to force refolding. Unknown/v1/v2 descriptor histories fail closed and remain unmodified; recovery requires a reviewed new child, never relabeling or fabricated conversion.
- Add strict-codec, descriptor/projection and exact-alpha.2 contract fixtures, plus an [official-first comparison and retirement plan](./docs/official-first-016-alpha2.md) for retained custom surfaces.
- Evidence remains limited: source markers, local rc.1-backed focused tests and fifteen scoped exact-source runtime tests passed (alpha.2 contracts 8, Remote 1 and Session-context 6; supplemental resolver with official TypeScript `6.0.3`, declared `mime-types@3.0.2` and `ws@8.21.0`, and shared Zod `^4.4.3`, no source/dependency patches). Full local `pnpm verify` passed: 1373 Vitest tests with 2 expected skips, 176 tooling tests, typechecks/build/package smoke; pack/tarball verification passed. Broad frozen dependency installation remains blocked by the configured mirror's `node-addon-require-builtin@0.1.6` HTTP 404. Full official-root-helper and CI qualification remain pending. This candidate is not a published-artifact, live Desktop, OAuth or model-call compatibility claim.

## 0.4.0-alpha.24 (prepared)

- Declare the exact `remote.githubCopilotSearchRouting` dependency in the search UI child Fiber so the Web search card can render under Cordis service tracing (#137).
- Regress the actual Client apply/render callback with real Cordis traced services on both the Models footer and legacy section, including independent account activation and routing-service loss cleanup.
- Preserve all account, cancellation and paid-fallback guards. Isolated tests do not claim packaged Desktop activation or live search success.

## 0.4.0-alpha.23 (prepared)

- Fix Model roles loading by exposing the dedicated Host `view`, `save` and `create` methods through the public Typert Remote service, retaining strict validation, CAS and session-creation ownership (#134).
- Replace Copilot-specific Auto/fixed labels and static provider suggestions with a real registered search-provider catalog shared by the primary and final-fallback selectors (#135).
- Follow the initiating Chat provider in Auto mode, keep an explicitly selected primary independent of Chat, and attempt at most one distinct final fallback. Preserve legacy settings without automatic writes and keep model choices provider-owned.
- Capture registration and account continuity before asynchronous work; silently revoked Copilot proof, cancellation, unload or registration replacement cannot authorize a paid fallback.
- Add real Host Gateway, registration-lifecycle, provider-routing and UI regressions plus an isolated built-component browser fixture. Preserve alpha.21 shared-peer ownership and alpha.22 React Client external declarations; no Core or live-profile changes are included.

## 0.4.0-alpha.22 (prepared)

- Declare React as the DSH Client ModuleLoader external used by the actual built Client bundle, while removing it from the strict Desktop Node peer graph and retaining it only for development.
- Extend packed-manifest validation from Host shared-package intersection to every declared required peer and Client external, preserving required authorization/schemastery Host peers.
- Regress the actual packaged Desktop 0.1.5 startup failure `requires missing react@^18.2.0` without bundling a second React instance or weakening `autoInstallPeers: false` graph validation.

## 0.4.0-alpha.21 (prepared)

- Move Desktop-owned `@deepseek-ai/dsh-authorization` and `@deepseek-ai/schemastery` from private runtime dependencies to required compatible peers while retaining development copies for standalone build and test verification.
- Audit every declared dependency and peer against the hash-pinned actual Desktop 0.1.5 runtime descriptor and generated Desktop 0.1.6 package-set input.
- Make packed-tarball verification reject bundled, optional, incompatible, or newly unaudited shared-package ownership without weakening Desktop validation or changing Copilot lifecycle, image-offload, Models, or authorization behavior.

## 0.4.0-alpha.20 (prepared)

- Add opt-in, bilingual **Model roles** settings with account-discovered planning and execution models, revision-checked save, and an explicit new-session entry.
- Capture the two roles only for dedicated new sessions; preserve existing conversations, global defaults, OAuth ownership and ordinary Subagent settings.
- Delegate implementation through native continuable executors with an exact route, scoped workflow controls, durable policy replay and explicit model-unavailable errors rather than fallback.
- Preserve create-request identity across uncertain results, and distinguish a confirmed not-created result from failed recovery of an existing session.
- Add real React DOM, actual Client Gateway, and Core Session/projection/tool primitive regressions, plus an isolated built-component browser fixture. These tests do not imply a live model call or production Desktop activation.

## 0.4.0-alpha.19

- Adapt the plugin compatibility contract to DSH `0.1.6-alpha.1` at
  `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`.
- Exercise awaited, serialized `agent/created` initialization before reading
  live Session state in the unchanged tagged-source fixture.
- Verify the 0.1.6 Session projection/history boundary, MCP v2 resource
  pagination, PTC runtime and `workflow-ptc` names, cancellable Sandbox/Shell
  preparation, optional-plugin startup policy, attachment cache separation,
  and Team task pagination without taking ownership of those Core services.
- Follow the 0.1.6 image-budget contract: preserve `IMAGE_OFFLOAD_REQUIRED`,
  apply the Core durable `image/offload` projection, and prove the retried
  Copilot request uses the mapped read-only normalized path without image bytes.
- Preserve provider-scoped Copilot tool-schema filtering and the existing
  immutable GitHub Release plus npm OIDC distribution design. This version is
  prepared for a Draft compatibility PR only; it is not published by this change.
