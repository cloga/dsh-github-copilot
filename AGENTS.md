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
6. Create/reuse a tracking issue and feature branch, implement a regression first, run the full gate, inspect the diff, and open a PR. For requested delivery, merge after required review/CI and branch protection without a separate approval prompt, unless the user limits scope. Important updates continue through the release-delivery rule below. Live-profile install and worktree checkout still require explicit user approval.

Use native DSH tools for goals, background jobs and scoped subagents. Use local Git and the GitHub REST API for delivery; no external orchestration daemon, roster or `vcs_*` tool is required. Do not assume a model provider's identity is the assisting agent.

## Product and architecture

`dsh-github-copilot` currently admits and targets only official DSH and Windows Desktop `0.2.0-rc.2`. Ten earlier DSH pins remain in `deployment-baseline.json` as historical evidence, not current support or CI release gates. It does not own a general Copilot chat adapter. DSH's built-in `llm-pi-ai` mount owns the GitHub Copilot provider, catalog, OAuth method and grant format, token exchange, refresh, and normal model transport.

This repository owns twelve narrow surfaces:

1. A conditional authorization-service bootstrap plus Host controller that joins DSH authorization, credentials, and settings.
2. A Client Models provider-card contribution with one shared account-state owner, Client-safe Remote descriptors and a nested plugin-owned model-preferences disclosure; embed in an existing configured canonical row, suppress its separate footer controller, and retain footer/old-Core section fallback when no such row is mounted.
3. Strict JSON normalization of pi-ai's provider-owned Copilot OAuth grant.
4. Preserve intentional absence of `llm-pi-ai.providers.github-copilot`; reconcile only existing legacy profiles and verified ownership journals. Fresh installations use the single account-discovered route; existing profiles require explicit migration, never silent removal.
5. Direct provider-hosted search using the same Host-side credential lifecycle.
6. Provider-scoped tool-schema compatibility for Copilot payload behaviors; Core remains the tool and execution owner.
7. A bounded account-discovery route that supplies validated endpoint/capability metadata to the published native adapter, including explicit managed Responses sampling compatibility, plus exact plugin-owned model exclusions enforced across its directory, Auto pools and direct admission, without maintaining model-ID routing rules or changing Core's catalog.
8. Optional, provider-scoped Chat presentation for completed empty reasoning disclosures; durable content and encrypted replay metadata remain Core-owned.
9. Compatibility-only policy restoration and request recovery for existing dedicated planner/executor Sessions. Model roles UI, settings writes and new dedicated roots are retired (#158); never reintroduce them or migrate histories implicitly.
10. Managed-route estimated input/output admission, optional exact-request pressure signalling through official compaction recovery, supported low summary effort only when no effort is already resolved, and default-off lossless gzip for explicitly opted-in account-proven HTTP Responses requests. See [compaction budgets](./docs/copilot-compaction.md). Preserve truthful capacities, requested output caps, native errors/replay and transaction ownership; no hidden history trimming, wire chunking, competing compaction service or automatic model switch. The separately selected, single-service [recovery engine](./docs/manual-compaction-recovery.md) defaults to automatic segmented recovery for known oversized summaries or one typed native capacity failure through the public subclass hook. Preserve `automaticRecovery: false`, native `auto: false`, scopes and custom engines; at most 16 physical calls including a failed first attempt, no recursive retry or 408/network/auth/quota fallback. Installation alone never selects or migrates an engine.
11. Optional account quota reads and a session-scoped composer usage control
through public credentials, strict Remotes and additive slots. Keep account
billing-cycle credits separate from context tokens and session cost. Missing,
pooled, legacy and stale data must retain their real semantics; never infer credits
from token estimates or account deltas. A separate plugin-owned historical context
projection may diagnose concrete failed-zero or invalid-sample incidents; ordinary
request progress and absent fresh sampling stay quiet. Never filter shared native
usage, replace Core's meter, infer current occupancy/percentages or rewrite history.
See [quota boundaries](./docs/copilot-usage.md).
12. Default-off local account/Checking/compaction diagnostics through public storage-domain and strict additive Remotes. Keep fixed-dimension Client/Host and logical/physical populations separate, with bounded handles/rows, 14-day retention, explicit loss/uncertainty and native commit evidence. Isolate the home-wide backend by public profile context, never account/Session identity; one writer per profile is required. No content, raw errors, identities/hashes, credential/history reads, ad-hoc files, Settings logs, upload, daily task or automatic repair. Enable/pause uses only the hidden volatile `diagnosticsEnabled` CAS leaf; clear is a separately confirmed epoch fence. Missing/corrupt storage remains unavailable, never healthy empty data. Publication does not enable collection. See [local diagnostics](./docs/plugin-diagnostics.md).

## Session-policy compaction replay consent (#349, #352)

`/copilot-compact visible-history` explicitly authorizes one lossy managed Responses
summary operation through the separately selected recovery engine. Scope consent
to the native summarizer signal, Session and account-proven model protocol; revoke
on settlement/cancellation/teardown. The persistent visible-history Session policy
also authorizes managed Responses automatic/manual summaries inside an observed
native compaction bracket. Freeze the active turn's persistent policy, or capture
the idle Session policy before summary dispatch; legacy next-turn-only consent is
not summary consent. Bind native Agent/Session, summary model and exact signals.
Remove historical reasoning and its embedded
summaries only from outgoing payloads, preserve visible tool relations and native
source/transaction ownership. Other protocols stay native; explicit one-time
commands still fail for unsupported routes. Never silently enable a disabled or
unknown persistent policy. Show actual filtering and native commit/failure/cancel
status through strict bounded ephemeral evidence and an additive composer notice;
only a verified replay-scope failure offers the same enable control when off.
Safe background diagnostics use bounded Error cause chains and fixed allowlisted
codes, never raw errors. Installation alone neither selects nor invokes recovery.
See `src/compaction-replay.ts` and `docs/manual-compaction-recovery.md` (#349).

## Approved multi-account ownership extension (#297)

Identity presentation uses additive `ensureIdentity` Remotes, including explicit-Agent Session lookup. Keep `get` metadata-only; visible surfaces may ensure on their sixty-second cadence. Fresh ten-minute cache avoids requests, same-account consumers join a bounded flight, and failures cool down thirty seconds unless explicitly refreshed. Credential notifications revoke pending work even when token bytes are unchanged; no late cache publication. Quota may settle independently only with account-coherent metadata. Presentation cache never replaces fresh identity validation for switch, reauthorization or duplicate checks. Preserve strict sanitized diagnostics and Session/turn ownership (#309).

Account display names survive freshness expiry in bounded Host memory, never credential invalidation or failed verification. Visible account lists may ensure missing configured names without activating accounts; no disk name cache, credential copying or identity-based authorization. Turn admission captures the first verified name for the frozen account. A missing name may be filled by one existing nonforcing account-bound lookup only during that exact active, uncancelled turn/signal; never after turn/end/disposal. Evidence still requires actual native delivery and never reconstructs completed history (#322).

The user approved independently authorized account records in the existing DSH credentials service. The canonical `llm-pi-ai/github-copilot` record remains unchanged as the compatibility account. Additional plugin-owned `github-copilot/account-<opaque-id>` records must be written directly by official pi-ai OAuth through public account-bound stores; never copy/move grants, refill the canonical record, introduce a separate credential storage service, patch Core, or implement another wire/catalog. Native `Models.getAuth()` and DSH `modifyRecord()` remain the refresh and serialization owners.

Settings store only the opaque global account selector and explicit `sessionAccounts` rows. Missing/invalid selectors or records fail explicitly, without another-account fallback. Models manages reauthorization/removal and the global default; Credits may select an already authorized account for this Session's subsequent turns, restore global inheritance or run add-only authorization without selecting it (#305/#318). An explicit choice equal to the default remains explicit. Freeze account ownership before Auto assessment and request admission, holding mutation fences until native `turn/end`/disposal; later Session/default changes never redirect running steps, retries or search. Account-local credentials, metadata, quota, proof cancellation and native adapter composition must remain isolated. Keep one public adapter/controller registration, with no second wire/catalog or Core changes. Reauthorization/removal of a pinned record stays blocked; global-default selection may continue independently.

Account selection shows the current account and a compact Switch dropdown with no account search, never a flat unbounded account list. Mark the current choice, scroll long lists internally and place Add at the bottom. Saved-account reauthorization/removal remains in a separate management disclosure. One Models Manage disclosure contains account management and cross-account exact-ID model preferences. Continuation settings belong beside account controls. Persist the initial default-on epoch and later global changes with path-level CAS; only unseeded Sessions born after a known epoch inherit it, never retroactively enroll existing/unknown/forked histories. Normal Client continuation uses only the persistent Session policy; no next-turn-only or temporary-recovery duration choices. Explicit-off account changes require persistent-enable/keep-off/cancel choices, then fresh account revision readback before CAS. Exact replay failures offer loss-disclosed persistent Enable/Cancel when off, diagnostics without repeated authorization when on. Missing policy evidence fails explicitly, never a temporary authorization fallback. Retain old next-turn/recovery strict Remote contracts and Host admission for compatibility; failure-evidence expiry does not disable the persistent policy. No automatic send/retry, history writes, private Settings navigation or inferred encrypted account origin. The approved synthetic mock and current navigation limit are documented in [account management](./docs/account-management-experience.md).

Use hidden volatile `sessionAccounts` with path-level SettingsForms CAS, readback and restart evidence. Session account Remotes use explicit viewed IDs, native Agent lookup and strict codecs, never automatic Client scope. Credits uses that Session's account for identity/quota, rejecting mismatched or late results. Historical Account is an additive assistant-actions disclosure beside native Usage, captured only after a real ordinary native chunk; bounded Host-lifetime evidence becomes unknown after restart/eviction and is never reconstructed from today's settings. No new durable events, history/default/model/Usage writes, automatic account fallback, replay deletion or message retry. See [the requirements and acceptance gates](./docs/copilot-accounts.md).

## Retired model-role compatibility boundary (#158)

`src/dual-model-host.ts`, `dual-model-types.ts` and `dual-model-remote.ts` retain compatibility for existing histories; see `docs/dual-model.md`. Do not restore the removed Client card or either Settings entry. `view` reports read-only retirement without discovery; `save` rejects; `create` can only recover a matching already-created request, never create a new root. The three strict Remote wire contracts and ten authorization/model-preference/migration descriptors retain their identities. Restore existing captured policy through the namespaced projection without deleting settings, converting history or changing routes/defaults. Unknown recovery evidence remains uncertain, not permission to create with another UUID. Existing dedicated tool restrictions remain workflow controls, not a sandbox against shell code. Ordinary Session/subagent behavior stays Core-owned; the pending native parent-model rules are separate work, not a new dependency or a shipped capability of this plugin.

Alpha.25 admits native `subagent/descriptor` v3, already v3 in the retained rc.1 baseline; the old v1 assumption was a plugin/test bug. Projection cache `stateVersion: 2` forces refolding, not history conversion. Unknown/v1/v2 or invalid child descriptors fail closed unmodified; review the original child's work and explicitly create a new child if needed, never relabel or fabricate a descriptor. Strict Remote codecs provide alpha.2 `create()` factories and retain the legacy `schema` bridge to the same strict parser, with no `src-json` downgrade.

## File map

- `src/index.ts`: authorization bootstrap, dependency-gated Host entry, settings registration, listener, and `ctx.web` provider composition.
- `src/authorization-controller.ts`: sign-in/status/sign-out and route mutation.
- `src/copilot-grant.ts`, `src/copilot-auth.ts`: strict grant normalization and narrow pi-ai `CredentialStore` adapter; canonical compatibility and explicitly selected account records follow the account-binding contract.
- `src/client.ts`: `settings.models.provider-card` account UI, a `plugins.bundle.config` provider-routing page with Models/footer/section fallback, and independently managed optional Chat integration.
- `src/web-search-routing-config.ts`, `src/web-search-routing-card.ts`: plugin-owned cross-provider live routing settings and the plugin-detail control surface. The user-facing page exposes only primary and fallback providers. Routing is stored directly under the existing `github-copilot` settings namespace at `searchRouting`, mutating both leaves via nested paths `['searchRouting', 'searchProvider']` and `['searchRouting', 'defaultSearchProvider']` in one CAS call; legacy separate routing namespaces are read as fallback only. Revisions coordinate between routing and legacy `searchModel` resets so subsequent edits do not false-conflict. Hosted-search safety settings remain schema-owned rather than a routine tuning form. The Models fallback retains routing only.
- `src/reasoning-presentation.ts`: guarded native Chat delegation and historical Copilot provenance; filters temporary view props only, never messages, signatures, replay indexes or usage.
- `src/remote.ts`: Typert Remote contribution. Never add credential payloads here.
- `src/copilot-usage-host.ts`, `src/copilot-usage-remote.ts`, `src/copilot-usage-card.ts`, `src/copilot-usage-ui.ts`: bounded Host quota snapshots, an independent strict namespace and reversible composer presentation. No real account fetches in tests, private Client store/DOM injection, quota-specific credential owner or general model wire.
- `src/context-usage.ts`, `src/context-evidence.ts`,
  `src/context-evidence-ui.ts`: diagnostic-only failed-zero/invalid-sample
  incidents and bounded numeric historical evidence through a plugin-owned public
  projection and additive composer disclosure. Keep ordinary progress quiet;
  dismissal is bounded Client presentation keyed by Session/incident, and a valid
  applicable sample clears the incident. Never filter native usage chunks to
  protect context readings: shared samples also feed Core's turn and cumulative
  accounting. Historical counts never become current occupancy; Core pressure,
  billing and durable events stay under Core ownership.
- `src/current-provider.ts`: selected DSH route plus installed pi-ai catalog facts.
- `src/account-model-catalog.ts`, `src/preview-provider.ts`: validated account endpoint/capability descriptors and published adapter composition. `responsesOmitTemperature` is an explicit default-off compatibility override for every managed Responses request; no supplier capability metadata is treated as temperature evidence.
- `src/temporary-models.ts`: exact, account-gated corrections with semantic protocol/capability retirement.
- `src/model-protocol.ts`: explicit Core capability detection and conservative legacy fallback.
- `src/responses-reasoning.ts`, `src/responses-reasoning-text.ts`: selected-model effort mapping and public summary assembly.
- `src/tool-schema-compat.ts`: Copilot-only prompt-assembly filter for unusable escalation arguments and action-specific Goal update schemas.
- `src/plan.ts`: Copilot-only, fail-closed hosted-search candidate lifecycle.
- `src/auto-assessment-evidence.ts`: bounded request-local semantic classifier milestones copied into strict ephemeral turn evidence; no prompts, replay, credentials or error bodies. Total includes preparation; adapter start and first text are not HTTP dispatch/byte timings. Keep one 8s monotonic deadline checked at preparation/native request/result boundaries and 128-token compact output; delayed timer settlement is not a real-time guarantee. Prefer eligible supplier-advertised reasoning-off classifiers, but request off only when supplier and public prepared-model effort agree; unsupported native controls stay unchanged. No guessed latency ranking, adaptive timeout, cooldown or cross-turn cache without reviewed observations.
- `src/probe.ts`: bounded native-search capability proof.
- `src/wire.ts`, `src/wire-anthropic.ts`: inline hosted-search streaming.
- `src/traditional-search.ts`: `github-copilot-hosted` `ctx.web` provider.
- `src/serialize.ts`, `src/sse.ts`, `src/failure.ts`: protocol conversion and bounded error handling.
- `src/response-error-body.ts`, `src/request-body-timeout.ts`, `src/request-upload-evidence.ts`: bounded clone-only HTTP error evidence and safe managed upload-timeout guidance. Request-scoped public Node diagnostic events supply numeric local body-write/header/ALPN evidence only after an exact verified `408/user_request_timeout`; absent events, multiple native requests and work limits stay explicit. Always dispose subscriptions when Fetch settles, without changing its arguments, Response/errors, dispatcher, proxy or retry owner. Local body-write completion is not upload duration, kernel ACK, supplier receipt or execution; its absence does not prove incomplete upload. Native failure classification/retry metadata stay unchanged; final JSON bytes are not tokens or a payload limit. A separate explicit opt-in compression setting is default-off and never activated by a 408; never infer overflow, auto-compact, trim history, switch models or add retries from a 408.
- `src/responses-request-compression.ts`: asynchronous `node:zlib` gzip at `Z_BEST_SPEED` only for exact account-proven official Copilot HTTPS `/responses` JSON POSTs through the existing public Fetch seam. `github-copilot.responsesRequestCompression` defaults false; enforce the 256 KiB minimum, 32 MiB compression-work bound and both 5%/4 KiB savings thresholds. Skips retain the original request with a fixed reason, and cancellation/account/deadline fences run before dispatch. No custom Fetch, other protocol, explicit `auto`/WebSocket, DNS/proxy/dispatcher changes, context-admission or replay changes, resend after an encoding rejection, or new retry. Gzip is wire encoding, not compaction or proof of supplier receipt.
- `src/request-body-evidence.ts`: verified-408-only, bounded numeric original-JSON span accounting through the existing fetch hook. Conversation/tool definitions/top-level system/residual partition total bytes; structural image and opaque replay spans are disjoint conversation subsets, never decoded contents. Unknown/limited evidence stays explicit. Fetch-to-header time excludes clone inspection and is not upload duration. With gzip, report original JSON composition and prepared HTTP-body bytes separately; neither establishes delivered bytes. No success-path analysis, retained body, automatic mitigation or supplier-limit claim.
- `src/copilot-stream-liveness.ts`: request-local HTTP/SSE byte-idle observation, paired with the public native adapter's bounded assistant-chunk deadline. Default five-minute byte idle and ten-minute semantic silence; no fake assistant output, private watchdog access, new retry or Core patch. Consumer think time is excluded; explicit WebSocket/auto stays native-only. `chatStreamLiveness: false` restores native-only timing. `chatMaxRequestImageBytes` retains Core's 20 MiB default; smaller explicit settings authorize only native image offload, not hidden history trimming or a guessed supplier limit. Synthetic heartbeat evidence is not production heartbeat proof.
- `tests/`: unit and integration evidence; mirror the source area being changed.
- `deployment-baseline.json`: declared machine-readable compatibility and capability evidence inventory.
- `scripts/verify-deployment-baseline.mjs`: invariant drift gate.
- `lib/`: generated release output; never edit it.

## Non-negotiable invariants

- Explicit replay recovery (#279, #289) is default-off and bound to the initiating native request signal, Session, model and current account proof. Only exact verified scope failures capture bounded full-item fingerprints; no replay bytes reach Client or storage. Public Session running/error snapshots trigger read-only notices on open/settled turns, never polling or durable recovery events. Two-stage confirmation chooses next matching turn (all steps/retries until turn/end) or bounded Session consent, omitting matching old encrypted items and their item summaries only on outgoing requests, never durable history or new reasoning. Preserve get/setEnabled descriptor identities and legacy session-consent semantics; authorize is additive. Active-turn writes, ambient-scope calls and automatic retries are forbidden. Expiry, disposal and proof discontinuity revoke evidence. See `docs/model-compatibility-acceptance.md`.

- Do not implement a second general wire adapter or independently maintained static Copilot model catalog. The account-scoped route composes the published adapter and SDK with validated supplier metadata.
- Protocol and capability corrections must follow authenticated, current account metadata; new model IDs must not need new implementation tables. Native pi metadata may be reused only where it agrees with advertised endpoints and capabilities. Matching IDs alone do not prove correctness or authorize migration back into another Core catalog. Preserve old bounded ownership journals solely for verified restoration of legacy writes, never for new global protocol overrides.
- Native Auto review compatibility must preserve Core's frozen request and strict fail-closed verdict ownership. Automatic reviewer-only omission uses the documented public `internal/get` service-read waterfall, exact Loader root ownership and independently imported official rc.2 `apply` callback equality through same-profile `PluginPackages.packageOf` facts. Clone before native `stream` delegation only for account-proven managed Responses. Recheck identity after await and revoke on disposal; aliases, descendants, impostors and unknown package identity remain native with bounded diagnostics. Never activate a second reviewer or use private caches/registries. Missing optional reviewer packages do not block plugin startup. Ordinary concurrent Chat stays unchanged. The separate legacy `github-copilot.responsesOmitTemperature` override defaults off and affects all managed Responses only when explicitly enabled; it is not the automatic reviewer policy or a capability claim. Never infer support from thinking metadata, match reviewer prompts/models/errors, intercept canonical routes, retry/resend, migrate settings, rewrite verdicts or change permissions. See `docs/auto-review-sampling.md`.
- Solve protocol gaps inside the plugin using existing published extension points. Do not require a new Core capability/service or patch Core to keep a single route. The managed account-model route reuses the published adapter with one shared OAuth grant; label multiple routes honestly. Keep canonical Core models/configuration under their existing owner instead of rewriting them from the companion's pi catalog.
- Preserve public Responses summaries and the effective selected-model reasoning effort. Never synthesize raw reasoning replay from summaries or read/decrypt opaque replay data; assistant reasoning/replay histories delegate to Core before probing.
- Do not require or silently support `copilot2api`, an external gateway, a pasted GitHub token, a placeholder key, or `dsh-web-search-provider`.
- The canonical compatibility credential record key is `llm-pi-ai/github-copilot`; additional account records are limited to the approved #297 contract above.
- OAuth credential payloads stay Host-only. Client Remote methods may expose status, notices, and errors only.
- Refresh must run through pi-ai `Models.getAuth()` and DSH `credentials.modifyRecord()`.
- Copilot OAuth grant writes must rebuild only pi-ai's documented provider fields as a fresh plain JSON object; unrelated extension values never reach DSH credential storage.
- Settings changes are path-level. Never replace the whole `llm-pi-ai` section or unrelated provider profiles.
- Sign-out deletes only the active Copilot credential record and keeps other records, the selector and route settings. A missing selected noncanonical slot fails explicitly; only an explicit eligible Add or Switch recovers it, never automatic canonical fallback.
- Hosted search serves either an eligible initiating `github-copilot` / managed `github-copilot-preview` route, or provider-owned independent search selected by the web-search router. Independent search preserves a nonempty explicit `searchModel` override; otherwise the Host considers at most three eligible Responses models from current account route facts, in deterministic ID order, without a static model list. Metadata alone is not search proof, and the final user query is sent once after candidate proof, never replayed across models. Both paths require an account-available model and supported search protocol; custom inline transport remains legacy-canonical only. Never substitute the global chat default or another Session's identity. The default `probe: true` path requires successful capability proof; `probe: false` is an explicit trust override, not an implicit fallback. Any request containing a file block, including one nested in tool-result content, must bypass the custom wire through `next()` so Core retains file projection ownership.
- Misconfiguration and API drift fail loudly with a named missing seam. Do not fall back to process-local secrets or implicit machine state.
- Host, Client, and Remote package entries must stay independently buildable and exported.
- The package must self-provide authorization when Core omits it, reuse an existing service without duplicate registration, and never activate the integration body before authorization is available.

## Session and migration ownership (V3, alpha.8, #99)

- One global Host account supplies many models; selected/history-backed Sessions retain independent model context. Auto-mode native search derives from the captured initiating Session's effective request-header/config or explicit `GenerateOptions`, never another Session or future global default C. Fixed/fallback Copilot search uses the explicit provider-owned `searchModel` override when nonempty, otherwise bounded automatic account-owned Responses selection; it never borrows the Chat model, another Session's selection or the global chat default. `Agent.options` is the activation seed, not selected Session-model evidence; `installModelSelection` overrides request/assembly; Core records the effective `Session.requestHeader().config` before tools. Without proven request context, traditional search is unavailable. A newly selected pending model must not reuse the old request header as current prompt guidance. Per-owner plan caches prevent different-model A/B reuse/cancellation; metadata remains shared.
- The ordinary Web search card selects only the primary and fallback providers and saves both routing leaves in one CAS mutation in the existing `github-copilot` namespace at `['searchRouting', 'searchProvider']` and `['searchRouting', 'defaultSearchProvider']`. It must not depend on Copilot model discovery, account credentials or a model selection to save routing. Capture traced Settings/routing Remote faces once per UI registration so parent renders do not reset drafts. Preserve a legacy nonempty `searchModel` override; display it read-only and reset it only through an explicit, separate narrow CAS setting `searchModel: ''`, never as a routing-save side effect. Because routing and `searchModel` share the `github-copilot` namespace and revision, successful mutation of either updates the other's expected revision to avoid false CAS conflicts while preserving unsaved drafts. Saving settings does not prove hosted-search capability.
- Cold Chat picker and `/model` `listModels()` ensure the shared managed source without Settings first. Actual cold managed search non-forcing ensures metadata before deriving facts; existing 24h maximum TTL, cooldown, credential, allowlist and capability/probe gates remain.
- Without `agents.currentInitiator`, traditional hosted search is unavailable with a named diagnostic; explicit marked `GenerateOptions` can still bind guarded inline requests, uncached if necessary. Credential notification during initial lazy discovery cannot distinguish own rotation from external account change via public status: fail closed with `WEB_PROVIDER_UNAVAILABLE` before probe/wire; a later user/driver request may retry, never automatically.
- The new native Copilot draft warning says Save adds another real group, not a second account. Public additive APIs cannot veto Add or disable Save; this is warning-only, not enforced single-route registration. Core Edit/Delete remain.
- Public `session.selectModel` also saves the future global default. Choose only approved Sessions/default; preserve other selected/history-backed Sessions, but do not promise unselected empty Sessions cannot inherit that default.
- Code does not auto-migrate settings, credentials or history. After plugin release, approved Ops migration may compare-and-swap only the reviewed user-native `llm-pi-ai.providers.github-copilot` path after ruling out base/journal conflicts, then read back settings and registry. No hidden groups, bulk rewrites or credential copying. Search allowlist updates to the managed ID require a separate reviewed Ops edit; never silently broaden old lists.

## Live migration readiness (alpha.9, #101)

- Use no-argument `githubCopilot.migrationStatus()` for fresh live-Agent evidence; generic `session/list` may be stale and plugin inventory alone has no loaded-version evidence. `src/migration-status.ts` reads public leaves synchronously and reports loaded build `plugin.name/version`, `protocolVersion: 1`, `observedAt`, capability flags and completeness flags. Missing/unknown/incomplete is not safe absence.
- Capabilities are `agentsList`, `sessionProjections`, `settingsCas`, `providerRegistry`, `defaultSelection`; `complete.sessions/defaultSelection/routes` describes evidence completeness, not migration approval. Effective selection uses pending projection, request-header config, then default only for genuinely empty Sessions with known projection state. Running `activeRequestSelection` is the latest recorded header, not proven in-flight LLM work. Native effective configuration and native/managed registration are separate flags.
- This read invokes no auth status/model discovery, credentials or network and mutates no settings/Sessions. No normal UI/global current-model/search card is added. Nine ordinary authorization/model-preference Remotes retain their codec; the tenth migration Remote uses a separate strict `GitHubCopilotMigrationStatus` codec.
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
- Official tag `dsh-v0.2.0-rc.1`, commit `4878cdabd87d4041bdaff61d04c966883b9fd07a`; the independently verified Windows Desktop feed also identifies `0.2.0-rc.1`.
- Official tag `dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84`; the signed installed Windows Desktop descriptor identifies the rc.2 shared peer graph.

The release admission, development dependency and CI targets are exact official `0.2.0-rc.2`; the other ten pins remain historical evidence only. CI runs the unchanged tagged-source runtime fixture and an isolated exact published-npm-artifact fixture for `0.2.0-rc.2` on Windows and Linux. The current fixture must await serialized `agent/created`, avoid new synchronous Session-history reads, and verify MCP resource cursors, PTC/workflow names, cancellable Sandbox/Shell preparation, optional-plugin startup policy, attachment cache separation, durable `IMAGE_OFFLOAD_REQUIRED` projection/retry and Team pagination without taking ownership of those services. Signed installed Desktop package-set evidence proves peer ownership only; neither it nor synthetic tests prove live endpoints, plugin activation, publication or loaded runtime state. Public Host, Client and Remote seams remain available; this baseline update does not authorize Core implementation rewrites.

These pins document compatibility evidence. They do not authorize creating another controlled Core patch or making one a prerequisite for new plugin fixes.

- Models UI: `0.1.2-rc.1`, `0.1.3-alpha.1`, `0.1.5-alpha.1`, `0.1.5-alpha.2`, `0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.6-alpha.1`, `0.1.6-alpha.2`, `0.2.0-rc.1` and `0.2.0-rc.2` expose `settings.models.provider-card`, keyed by settings namespace `llm-pi-ai`, to embed login/status/Refresh/Manage in a mounted configured canonical `github-copilot` row and suppress the separate footer controller. With no such row mounted, retain footer fallback; historical 0.1.1-rc.2 uses a dedicated `settings.section`. Preserve the shared account-state owner across transfer only while another eligible surface remains mounted. Unmounting the last surface or replacing declarations without overlapping mounts stops polling; a later controller reads status and separately non-forcing ensures missing/idle/stale/error/loading signed-in metadata, without replaying the old forced-login action. Manual Refresh models lives inside Manage; errors expose Retry. Opening Models is no longer guaranteed network-free, but status/details themselves remain pure. This additive slot cannot replace Core Edit/Delete: retain the native editor, while normal plugin discovery needs no manual model definitions. UI integration must not merge/remove actual canonical and `github-copilot-preview` routes or rewrite credentials, configuration, history or selection.
- Canonical authorization flow key: `llm-pi-ai/github-copilot`; additional account flows bind directly to their own plugin-owned record under the approved #297 contract.
- Authorization verification links recognize the public `window.dshDesktop.protocolVersion === 1` marker and use `_self` so Desktop's existing `will-navigate` handler opens the system browser without popup creation. Other hosts retain `_blank`; display a selectable manual URL in both cases. This does not confirm browser launch or OAuth success. Manage omits the compatibility disclosure but retains actionable legacy diagnostics and explicit repair; migration documentation and backend ownership are unchanged.
- Authorization service: rc.1 Core provides it; the rc.2 web/headless profiles rely on this package's runtime dependency and conditional bootstrap.
- Credentials: use record description/read/modify/delete APIs on the Host. Never read records in the browser.
- Copilot grant schema: `type: oauth`, non-empty `refresh`/`access`, finite `expires`, optional non-empty `enterpriseUrl`, and optional deduplicated non-empty-string `availableModelIds`.
- Settings: never recreate a missing `providers.github-copilot` profile. Existing native profiles remain user/Core-owned and require explicit migration before only the account-discovered route is listed.
- Per-model API: do not assume stock Core honors a configured model.api. Verify the existing published behavior; where it cannot serve a model, use a plugin-local, exact-model alternative or report the limitation rather than patching Core.
- Route activation: the dormant `llm-pi-ai` mount observes the profile and registers the route.
- Client activation: package metadata injects DSH remotes and Models UI; `./client` mounts `./remote`.
- Provider headers: rc.1 validates configured headers through Fetch and reuses Host-owned headers during model discovery.
- Remote results: the nine ordinary authorization/model-preference methods retain the Zod v4 `GitHubCopilotAuthorizationView` strict codec required by rc.2 and accepted by rc.1. The tenth no-argument `migrationStatus()` method has a separate strict `GitHubCopilotMigrationStatus` codec; it does not change the ordinary auth contract.
- Single-model saves use the additive `setModelExcluded(modelId, excluded)` Remote with an independent strict `GitHubCopilotModelPreferencesView` result. Preserve the ten existing descriptor identities/codecs. Do not read credentials, discover models or enumerate Sessions on this mutation path; confirm native CAS persistence before returning.

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

- User-requested important updates include user-visible features, behavior fixes, compatibility fixes, and security or stability fixes. Their default delivery includes publication after a reviewed merge and green required CI; do not stop at a merged PR or ask a second time whether to release.
- Explicit user restrictions such as code-only, review-only or do-not-release take precedence. Pure documentation and internal-only changes are not automatically release-bearing; they need an explicit release request if publication is desired. A task plan is not permission for an unrelated release.
- Plan version alignment with the implementation PR whenever possible. If the prepared version/tag is unused and aligned, release it; otherwise prepare the next appropriate SemVer version through the normal PR path. Preserve the prerelease channel unless promotion is explicitly requested. Any additional version PR follows the same required review/CI and branch protection, without a separate merge-approval prompt.
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

Desktop plugin upgrades do not necessarily reconcile profile-local copies of Host peers. Check the actual resolved `@deepseek-ai/dsh-authorization` (and other shared peers) against the Desktop's bundled package set after upgrades: an older profile-local authorization package can shadow the current bundled service, fail peer validation and prevent dependent account plugins from starting. Do not delete or replace live files as part of plugin compatibility work; use a separately authorized repair and verify module resolution.

## Mechanical verification

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
```

Then run `pnpm verify:tarball -- artifacts/dsh-github-copilot-<package-version>.tgz` on that exact archive. `node scripts/agent.mjs plan release --json` supplies the versioned argument without shell interpolation or platform assumptions.

`pnpm verify` checks the Agent contract, source and local test types, baseline markers, a clean build, Vitest tests, Node tooling tests, and real built Host import/Client-loader/Remote smoke. `tests/fixtures` are intentionally excluded from local test typecheck because they import source from a separate pinned Core checkout. The checked-in code must pass; never suppress compiler errors or weaken a test to get a green report.

If the exact frozen install is blocked solely by an enterprise registry or network policy while the repository's GitHub Actions can obtain the unchanged pinned packages from an authorized official registry, record the attempted command and exact environmental failure as **local validation blocked**, not passed. A PR may proceed with that limitation disclosed; the complete required GitHub CI matrix, including its install, tests, build and package checks, is then the authoritative gate before merge. Never weaken or skip CI, substitute dependencies, bypass organizational restrictions, claim unrun local gates succeeded, or tag/release a revision whose required CI is not green. If CI has the same failure, resolve it through approved infrastructure rather than bypassing it.

The release CI matrix targets only exact official `0.2.0-rc.2` on Windows and Linux; earlier pins are not support gates. It runs the unchanged tagged-source runtime fixture, optional native Chat fixture, and exact published-artifact adapter fixture. This is a required gate, not evidence that a candidate qualification has executed. `verify:upstream` is static seam-marker evidence. `verify:controlled-core` exclusively installs a temporary config fixture, refuses an existing target, and removes only its own file; it is not full plugin activation. Published-artifact synthetic adapter fixtures do not prove live provider transport. The release job must wait for the complete reusable CI matrix on the tagged revision, then verify its own packed bytes before publishing.

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
| README screenshot | `copilot-search-routing.png` shows the current built plugin-detail routing card with synthetic providers in an isolated browser fixture. It proves only the current presentation surface, not live credentials, provider availability, search success or Desktop activation. |
| Host attach/restart | Reconciles the stored profile; search proofs stay lazy and do not start at attach |
| Background credential/reset notifications | Invalidate evidence and clear Client state with read-only status; no forced discovery on every token event; next Models open/use ensures metadata |
| Eligible model/search request | May resolve/refresh credentials and run bounded capability proof; changes during proof must fail closed rather than reuse another account's proof |
| Release install | Writes a named user profile; installed on disk is not loaded in the running Host |

Never say GPT-6/search works merely because settings, typecheck or a package import passes. Report the layers separately. Keep synthetic credentials in fixtures; no real sign-in, logout or API call just to produce test evidence. Do not recommend disabling capability proof as a routine repair. Preserve logs locally and report only redacted facts; route security-sensitive findings through SECURITY.md.

## Changing capabilities

Auto routing, assessment, cost weights, continuity and assistance changes must
first read and validate `docs/auto-iteration-review.json` using
`scripts/iteration-review.mjs`. Follow `docs/evidence-driven-iteration.md`:
missing data stays explicit, PRs record the decision and validation, and the
post-delivery review has an owner, sample trigger, metric and action. Never
upload local diagnostics automatically. See `docs/auto-high-cost.md` for the
orthogonal user-cost policy and separately gated advisor acceptance.

Continuation processing is reasoning-only: never recursively traverse or serialize
ordinary payload content to impose a whole-request limit. Preserve bounded
top-level item/ciphertext work, yielding cancellation and turn-revocation checks,
atomic baseline initialization and awaited final-byte retry evidence. Native token
admission and automatic-compaction transactions/rebuild stay independent; never
classify a continuation processing bound as context overflow.

Context evidence and replay recovery use the public full-width `conversation.input.dock`
above the composer, with shared native secondary typography. Do not restore long
notices to the nonwrapping statistics row or mutate its parent DOM. Scope errors
keep concise recovery guidance; bounded dispatch counts are separate Host diagnostics,
not proof of the rejected item, account-switch failure or recovery success.
Ordinary context-request progress stays quiet. Only concrete sequenced sampling
incidents may notify, with bounded Session/incident dismissal; missing or unknown
projection evidence remains a named diagnostic and never fabricated health.

Completed-turn Usage diagnostics (#259) are read-only plugin conversation data and an additive assistant-actions explanation. Official rc.2 hides its total if any attempt lacks complete accounting; the plugin's finish-only pre-dispatch pressure block can trigger this rule even after recovery. Never fabricate zero usage or replace it with successful-step partial totals. Identify local interception only from its exact recorded finish-only diagnostic, keep other missing samples and paged evidence uncertain, and suppress the explanation whenever native `tokenUsage` exists. Preserve native accounting, history, pressure and recovery; see `docs/copilot-usage.md`.

Auto task routing (#258) uses current `model_picker_category` facts, never model
names, effort or context capacity as a quality category. Hard eligibility/input
fit precede task/preference policy; unknown category and uncertain task evidence
remain explicit. Within the first fitting category, apply positive cost weights
(ordinary 1, marked 0.2) and finite continuity (previous model multiplier 1.5),
never unconditional retention or extreme-only cost gating. Capture actual reasons once
per turn without durable decision events or changing Usage.
`autoSemanticAssessment` is default-on by explicit user rollout request (#267),
only for locally unknown demand; preserve explicit false opt-out. One bounded concrete
native-adapter request, no tools/Auto recursion/new retry, explicit failures and
omitted-context conservatism. Extra supplier charges are separate from Chat
Usage. Default rollout is not labeled-corpus calibration; require that evaluation
before claiming calibrated performance. Synthetic tests do not prove GitHub-private
routing equivalence. See `docs/auto-task-routing.md`.

The turn selection Host endpoint must use `TurnSelectionController`, extending
public `TypertRemoteService` with `@Remote get`. A plain `ctx.provide` object
cannot supply the native gateway binding or source method discovery. Test both
actual Client and Host gateways; a synthetic RPC success cannot prove Host
reachability. Preserve native Agent lookup and bounded store ownership (#254).

Automatic pressure and Auto recovery availability resolve the initiating Agent's bound preset through public `agentPresets.composedPreset()` / `serviceFor(agent, 'compaction')`. A bound preset without an engine must not borrow global recovery. Only non-preset Agents use their own `agent.ctx.get('compaction')`; never scan Core's private registry or cache an engine across preset replacement. Native transactions, cancellation and retry policy remain unchanged. The selected recovery subclass uses initiating-Agent account proof and public initiator scoping for automatic/manual summaries. Multi-call results stay unmarked; omit aggregate usage after a failed initial call. No automatic profile migration or full preset replacement.

Continuing-step pressure prevention uses public `agent/pre-step` before `step/start`, only with a committed managed header, no selection notice, and known `modelSelection.pending: null`. Capacity lookup is not request estimation. Use the native surface meter and one currently bound native transaction; preserve final converted hard admission and stream-pressure fallback. First-step/pending/unknown evidence delegates. Native compaction failures propagate before attempt admission. Never claim all missing turn Usage is repaired, filter native samples, invent zero usage or rewrite historical totals. Native turn-tail accounting groups events by recorded turn, not compaction replacement sequence range.

Selection footer Remote calls carry an explicit viewed Session ID and turn.
Do not add an automatic Client `scope` projection: rc.2 prefers the scoped
variant and removes the ID argument, breaking the footer's two-argument call.
Retain native Host agent lookup/access checks and strict codecs. Failed reads
must remain distinct from successfully read missing evidence; Retry reads the
same turn only and never replays inference. See #249.

Parent-model following uses the profile-wide `github-copilot.followParentModel` switch (default false), with a single control in the plugin-detail page (#234). Never require per-session enrollment for the ordinary experience. Preserve legacy `parentModelFollow` bindings independently, including when the broad switch is off. `src/parent-model-follow.ts` and the Auto Host integration use public projections and per-turn scoped routing, never descriptor/history/default writes. Child-owned explicit selections win; enabling authorizes replacement of creation-time route snapshots, not removal of later picker history. Only supported native spawn children and managed Copilot parents participate; roots, other providers, fork descriptors and historical dedicated policies remain native. Missing eligible parent evidence fails explicitly. Settings changes preserve admitted turns, and Client saves use one path-level CAS without credentials/discovery. See `docs/parent-model-follow.md` for requirements/mockup and `docs/automatic-model-routing.md` for exact-source evidence.

Model preferences must survive the Client's owned-field projection before strict decoding. `excludedModelIds` is a hidden volatile Config leaf, read via `readInlineConfig`; exercise native SettingsForms CAS, fiber preservation and restart persistence, not only map-backed settings mocks. Missing preference settings leave model rows read-only with named diagnostics and status-only Retry. Unknown exclusion state is not an empty exclusion set. Discovery diagnostics stay in a separate Manage disclosure. Selected models are excludable without scanning Sessions/defaults; the legacy `lockedModelIds` wire leaf stays empty. Check exclusion at new-turn admission through public `agent/request`, preserving only the same Session/turn/model and exact native request signal for subsequent steps/retries. Clear admission on `turn/end`. Direct/unbound requests and new turns remain excluded; never rewrite selections/history or switch models silently. Account/token/metadata/cancellation guards remain independent and revocable.

Capture the traced `remote.githubCopilot` namespace once per account UI registration, shared by provider/footer/section renders. Native namespace property reads create fresh proxy identities; rereading during parent renders resets the mounted account controller and can block exclusion changes on redundant status/discovery work. Actual registration teardown and credential/connection invalidation retain their existing safety semantics.

Auto history compatibility (alpha.54, #204): official rc.2 `Session.append()` has no public ignorable-envelope option. Do not emit optional `github-copilot/auto-model-decision` events or borrow another event type; retain native real-model provenance and durable Auto selection without new durable decision recording. The assistant-actions selection footer reads bounded Host-lifetime decisions through native agent-scoped lookup and compatible historical events. Explicit captured fixed selection alone proves Manual; missing evidence is unknown, never reconstructed from today's picker. User-approved #310 permits model evidence only inside the existing selection dialog when native Usage lacks complete routes: successful same-turn assistant/message sources are Recorded models; public request/header snapshots inside a recorded same-turn open step are Requested model, never dispatch/execution/billing proof. Preserve multiple routes and incomplete failed-attempt attribution. Missing/invalid/paged evidence is unknown, read failures remain separate and Retry rereads the same Session/turn. Do not add a Model details/footer button, change native Usage/context metering or modify parent DOM; complete native routes avoid redundant model presentation. No closing message means no assistant-actions anchor. The independent bounded public Session projection refolds existing native events only, never emits events or inherits adjacent headers. `scripts/repair-auto-model-history.mjs` is explicit source-checkout maintenance, not a runtime hook: strict pinned official v4 validation, check-only by default, optional detached repaired copy plus byte-exact backup. It never replaces live history. Applying a copy requires separately approved stopped writers and a fresh source-hash check. See `docs/automatic-model-routing.md`.

Auto intent continuity (#293) uses the strict `githubCopilotAutoModelIntent` public Session projection of existing owner-explicit `model/selection` events. Execution headers cannot erase intent; fixed/other-provider choices replace it for future turns. Ignore copied fork/child prefixes, retain native pending and parent-follow precedence, and diagnose missing/invalid evidence. Freeze admitted Auto route configuration across late choices without writing history, settings or historical reasons. Projection disposal must remove only its own registration.

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
- State expected results and scope before the complete gate; compare actual outcomes before pushing. All required reviews and CI checks must pass before merging.
- Push only the feature branch and open a PR targeting the resolved default branch with `Fixes #<issue>`. Include risks, tests, evidence limits, and rollback.
- A user request to deliver work permits merging its PR after required review/CI and branch protection without a separate approval prompt; honor explicit code-only, review-only or do-not-merge restrictions. Installing into a user profile, sign-out and worktree checkout still require explicit user approval. Important-update publication follows the standing release-delivery rule above, not a second release prompt; other releases need an explicit request. Never bypass branch/tag protection.

GitHub operations must use the repository owner's intended authenticated identity. Inject credentials only into the current Git/API process; never print or persist them or add machine-specific credential paths here. Network failure is not an authentication failure: follow user-authorized network recovery, bound retries, preserve local work and report pending remote delivery honestly.
