# dsh-github-copilot

[![CI](https://github.com/cloga/dsh-github-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/cloga/dsh-github-copilot/actions/workflows/ci.yml)
[![Release](https://github.com/cloga/dsh-github-copilot/actions/workflows/release.yml/badge.svg)](https://github.com/cloga/dsh-github-copilot/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/cloga/dsh-github-copilot)](https://github.com/cloga/dsh-github-copilot/releases/latest)
[![License](https://img.shields.io/github/license/cloga/dsh-github-copilot)](./LICENSE)

**English** | [简体中文](./README.zh.md)

A focused DSH companion for GitHub Copilot sign-in, account-aware model profiles, Copilot-specific tool compatibility, and provider-hosted search. It reuses DSH's built-in `@deepseek-ai/dsh-llm-pi-ai`; it is not a second Copilot model adapter or catalog.

## Compatibility baselines and qualification targets

| DSH surface | Exact source pin | Models UI seam |
|---|---|---|
| Controlled Desktop `0.1.1-rc.2` baseline | Controlled Core commit [`a772dbb`](https://github.com/cloga/deepseek-harness/commit/a772dbbde82780bff2b9394427e9f0a24cafa1d5) on `cloga-pi-ai-model-api` | Dedicated **Settings → GitHub Copilot** section |
| DSH `0.1.2-rc.1` | Tag commit [`a66e470`](https://github.com/deepseek-ai/deepseek-harness/commit/a66e4702047846cdaa10c66c9d3df3951f5ea70d) | **Settings → Models** provider card |
| DSH `0.1.3-alpha.1` | Tag commit [`d347e70`](https://github.com/deepseek-ai/deepseek-harness/commit/d347e703908d0406b7a7ef80e3a0e594d86b2215) | **Settings → Models** provider card |
| Official DSH `0.1.5-alpha.1` | Tag commit [`5dda764`](https://github.com/deepseek-ai/deepseek-harness/commit/5dda764ed3aa172535a7967b06ff95d9cbfe536a) | **Settings → Models** provider card |
| Official DSH `0.1.5-alpha.2` | Tag commit [`b2e3b2a`](https://github.com/deepseek-ai/deepseek-harness/commit/b2e3b2a0125854567a4a5fcba75782e42fe84901) | **Settings → Models** provider card |
| Official DSH `0.1.5-rc.1` | Tag commit [`183f08e`](https://github.com/deepseek-ai/deepseek-harness/commit/183f08e9c6dde7e36cd2318eaee70b0da08fb35e) | **Settings → Models** provider card |
| Official DSH `0.1.5-rc.2` | Tag commit [`fb2c4b9`](https://github.com/deepseek-ai/deepseek-harness/commit/fb2c4b9e698e30edb738bca4cf0618587db7d203) | **Settings → Models** provider card |
| Official DSH `0.1.6-alpha.1` | Tag commit [`0a15e36`](https://github.com/deepseek-ai/deepseek-harness/commit/0a15e36e7f82b6ed45af6fa9759f29b40dcd965d) | **Settings → Models** provider card |
| Official DSH `0.1.6-alpha.2` (current qualification target) | Tag `dsh-v0.1.6-alpha.2`, commit [`ddefc45`](https://github.com/deepseek-ai/deepseek-harness/commit/ddefc45fbc7f8e46dd73185e68295696d1297887) | **Settings → Models** provider card |

The table retains historical source pins; it does not imply the account-model route has been verified on every baseline. Published-artifact synthetic transport tests use the **rc.1 adapter with pi 0.85.1**; development dependencies remain pinned to `0.1.2-rc.1`. The controlled rc.2 pin is historical regression evidence only. DSH `0.1.3-alpha.1`, official `0.1.5-alpha.1`, `0.1.5-alpha.2`, `0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.6-alpha.1`, and `0.1.6-alpha.2` are unchanged tagged-source targets: CI exercises each through an isolated test resolver, without building or patching Core. These source-runtime checks must pass before claiming compatibility; they do not establish standalone npm-artifact, live endpoint, installed Desktop, or loaded-runtime proof. Existing public Host, Client, and Remote seams are retained. Stock Core model-entry `api` support is not a prerequisite for the plugin-owned route. Package peer and `engines.dsh` ranges are admission declarations, not live compatibility proof. No Core patch is installed by this plugin.

### Alpha.11 compatibility correction (#105)

Core `0.1.5-alpha.2` requires `ResolvedPiAiProviderProfile.modelErrors` and reads it unconditionally in `PiAiAdapter.modelOf`. The plugin now supplies its own empty diagnostic map: account descriptors have already passed validation, and rejected models never enter the provider. No upstream profile, catalog, prototype or dependency artifact is changed. Actual pinned-adapter tests cover resolution, preparation and synthetic streaming; the older pins retain the same plugin code.

Legacy Anthropic inline requests containing an in-band `system` message delegate unchanged to Core **before probing** rather than demoting system authority to a user turn. This intentionally limits inline search on those requests. The legacy Responses inline wire retains its existing mapping of explicit system content to user input text; this is not system-message filtering. The managed route always uses native Core transport. See the [seam audit and evidence limits](./docs/agent-readiness.md#core-alpha2-compatibility-follow-up-105-planned-alpha11).

### Alpha.12 release prerequisite correction (#107)

The first alpha.11 publication attempt stopped before packing: the tagged Session/Remote fixture required Core's `mime-types` dependency, but the release job installed only the pi-ai closure. CI and release now explicitly install the unchanged pinned Session Controller dependency closure before that fixture runs. The tests remain enabled; no Core source or live dependency is patched. Alpha.12 carries the same runtime compatibility fixes with a fresh release version.

### Alpha.17 provider-aware web search (#118)

The bundle routes search through a plugin-owned Models-page policy: `auto` prefers eligible native Copilot search and otherwise uses the configured default provider; `fixed` always uses that provider. A separately selected account model lets Volcengine and other non-Copilot chat Sessions use Copilot hosted search. The implementation uses public web-service composition without Core or preset edits. Source and synthetic tests are not proof of live Copilot search, release publication or local activation; see [routing evidence](docs/session-search-routing.md).

### Alpha.19 DSH 0.1.6 compatibility adaptation (#125)

The exact `dsh-v0.1.6-alpha.1` source fixture now awaits serialized `agent/created` initialization before reading live Session projections. Static and runtime gates also verify the retained request-header/projection path instead of adding synchronous history reads; MCP SDK v2 resource cursors; the `dsh-ptc-runtime` and `dsh-workflow-ptc` contracts; empty model environment for isolated Node PTC; asynchronous cancellable Sandbox/Shell preparation; consumer-owned optional-plugin startup failures; attachment request caches under DSH cache while normalized attachment paths remain stable; and provider-owned Team task pagination. For image-budget recovery, the adapter's first `IMAGE_OFFLOAD_REQUIRED` result remains an error; the fixture records the Core `image/offload` projection and proves the retried Copilot request sends the mapped read-only normalized path as placeholder text without image bytes. The plugin does not import or own MCP, PTC, Workflow, Sandbox, Shell, or Team services. Upstream exposes no generic `HostGrant`/`hostGrants` API in this tag, and the plugin registers no such coupling. Copilot schema compatibility continues to remove unsupported escalation controls from `pwsh`, filesystem, and `run_code` schemas while preserving Team pagination fields. This compatibility version is prepared as a Draft and is not a release claim.

### Alpha.21 Desktop shared-package ownership fix (#125)

The candidate manifest treats `@deepseek-ai/dsh-authorization` and `@deepseek-ai/schemastery` as required Host peers instead of private runtime dependencies. Development copies remain pinned for standalone build, unit, Host import, Client loader, and Remote codec verification. The packed-tarball gate audits every declared dependency and peer against a hash-pinned actual Desktop 0.1.5 runtime descriptor and the generated Desktop 0.1.6 package-set input; it rejects bundled, optional, incompatible, or newly unaudited shared ownership. The 0.1.6 package-set is authoritative input to descriptor generation but is not a materialized Desktop descriptor, live activation, OAuth, or model-call result. This change preserves the existing Settings → Models provider card, authentication flow, lifecycle adaptation, and image-offload behavior, and does not weaken Desktop validation.

### Alpha.22 Client React ownership fix (#132)

The built Client intentionally requests React from DSH's browser `ModuleLoader` singleton. React is not a Desktop Host shared package and must not be installed as a required Node profile peer. Alpha.22 declares `dsh.client.external: [\"react\"]`, removes the root React peer, and retains React only as a development dependency. Packed verification now audits every required peer and Client external, confirms the real built Client requests exactly React from the loader, and preserves authorization/schemastery as required Host peers. This fixes the packaged Desktop startup error `requires missing react@^18.2.0` without enabling peer auto-install, bundling another React copy, or weakening Desktop graph validation. Actual packaged Electron loading remains a downstream acceptance gate.

Alpha.24 fixes the Web search card's missing traced Remote dependency. It remains in **Settings → Models** (`settings.models.footer`, list/root), with an old-Core Web search section fallback, not General. The search child waits independently for its routing namespace; account controls and all search safety guards are unchanged. Actual packaged Desktop acceptance is still a separate gate.

### Alpha.25 official-first DSH 0.1.6-alpha.2 adaptation

The candidate appends the ninth exact target, `dsh-v0.1.6-alpha.2` at `ddefc45fbc7f8e46dd73185e68295696d1297887`. Strict Remote descriptors now provide alpha.2 `create()` factories while retaining a legacy `schema` bridge to the same strict parser. Dedicated executor projection admission uses native `subagent/descriptor` **v3**, already v3 in rc.1: the old v1 assumption was a plugin bug, not an upstream v1-to-v3 migration. Projection cache **`stateVersion: 2`** forces refolding, not history conversion. Unknown/v1/v2 descriptor histories fail closed and remain unmodified; review the old child and explicitly create a new child if needed, never fake a conversion by relabeling its descriptor.

Source markers, local rc.1-backed focused tests and fifteen scoped exact-source runtime tests passed (alpha.2 contracts 8, Remote 1 and Session-context 6). Full local `pnpm verify` passed: 1373 Vitest tests with 2 expected skips, 176 tooling tests, typechecks, build and package smoke; pack/tarball verification also passed. The scoped run used a supplemental resolver with official TypeScript `6.0.3`, declared `mime-types@3.0.2` and `ws@8.21.0`, and shared Zod `^4.4.3`, without source/dependency patches; it is not full official-root-helper qualification. Broad frozen dependency installation remains blocked by the configured mirror returning HTTP 404 for `node-addon-require-builtin@0.1.6`. **CI qualification has not executed.** No published-artifact compatibility, live Desktop activation, OAuth or real model-call success is claimed. The [official-first matrix](./docs/official-first-016-alpha2.md) records exact official sources, support scope, retained gaps and retirement triggers rather than assuming missing parity from feature names.

## Copilot usage beside the composer

Alpha.33 corrects alpha.32's missing selector argument to the public Session hook, which could retire the registered usage entry after a render failure. Positive eligible-Session rendering must be verified separately from installed-version receipts or signed-out absence. The fix is plugin-only; no Core patch or automatic restart is included.

For a Session using `github-copilot` or `github-copilot-preview`, an optional **Credits** control shows the signed-in account's reported billing-cycle usage and remaining allocation. It uses the public composer dock, leaves the native Context meter unchanged, and disappears for other providers. Open it for budget, reset time, freshness and refresh details. Unsupported Client slots disable only this optional control.

Alpha.35 matches native secondary statistics typography and pill spacing. A host with a shared wrapping dock can place Credits directly after Cache hit and wrap entries when space runs out; older hosts retain their own layout. A reading wider than its allocated width is ellipsized, with its complete text retained for accessibility, the tooltip and independent details. The plugin does not move native DOM or replace statistics; [responsive layout ownership and evidence limits](./docs/copilot-usage.md#responsive-statistics-presentation-alpha35) remain explicit.

Numbers are not token estimates: legacy accounts show **Premium requests**, a shared organization pool may provide used credits without any individual remaining balance, and absent data is **Unavailable**, never zero or unlimited. Failed refreshes may retain explicitly **last-known** same-account values; authentication/account invalidation removes them. Per-session credits are not displayed because the supported native adapter does not expose complete provider-reported credit accounting through the public plugin contract. They are not inferred from account deltas. Reset time is shown only when a valid supplier-reported next-reset date is later than the snapshot observation; missing, invalid, zero or elapsed reset metadata is omitted without discarding otherwise valid account amounts.

The Host reads GitHub's internal quota endpoint using the existing canonical OAuth grant, with bounded requests and cache lifetimes; no new sign-in, credential store, model transport, settings write or model switch is added. This internal endpoint can change or deny access; enterprise custom endpoints are not guessed. The public enterprise/organization metrics reports are not used as a live personal balance service. See [data semantics, lifecycle and evidence limits](./docs/copilot-usage.md). Synthetic tests do not establish real account access, billing freshness or installed Desktop activation.

## Install and sign in

The commands below target the package version `0.4.0-alpha.37`. Versioned URLs describe the intended release artifacts, not proof that publication or local activation has completed; use them only once that Release and its checksums are available. Install into the profile you use (replace `web` when targeting another profile):

Before installing/updating, unpack the **checksum-verified** archive into a temporary directory and run its read-only composition preflight (replace all paths with absolute paths for the intended profile):

```sh
node package/scripts/check-search-composition.mjs --profile-dir /absolute/profile --home /absolute/DSH_HOME --install-anchor /absolute/dsh/package.json
```

Include any launcher patch files with repeated `--patch /absolute/file` arguments. Require `supported: true`; otherwise do not install the routing bundle. The preflight rejects custom, disabled, nested or already-isolated web-service layouts and reserved routing collisions before any mutation. It parses through public Core APIs and never boots plugins, resolves credentials or rewrites configuration. **`dsh plugin add` does not automatically run this preflight.** It is a required installer/operator step, not a universal compatibility guarantee.

For approved online installation, the supported CLI command is:

```sh
dsh plugin --profile web add https://github.com/cloga/dsh-github-copilot/releases/download/v0.4.0-alpha.37/dsh-github-copilot-0.4.0-alpha.37.tgz
```

If registry access is blocked or unavailable, do not retry it through another network. Desktop-managed profiles may instead use the [controlled offline CLI procedure](./docs/npm-distribution.md#controlled-offline-cli-maintenance), with an approved, checksum-verified local Release and existing dependency cache (`--offline --ignore-scripts`). All preflight and approval requirements still apply.

Then open the Models UI listed above, find **GitHub Copilot**, select **Sign in**, and complete the GitHub device-code flow. Plugin installation changes the selected profile; activation follows that profile's normal reload/restart policy.

### User authorization flow

1. Open **Settings → Models** and find **GitHub Copilot**. Account controls appear in an existing configured canonical `github-copilot` card, suppressing the separate footer controller; otherwise the footer fallback (or old-Core **Settings → GitHub Copilot**) remains usable. An already-signed-in account automatically ensures missing/idle/stale/error/loading metadata once on opening; fresh ready metadata makes no discovery request. No native provider or manual refresh is needed for the normal discovery flow.
2. Select **Sign in with GitHub**. The authorization area expands automatically with a prominent one-time code, **Open GitHub verification page**, **Copy code**, and **Cancel sign-in**. No extra **Manage** click is needed. Recognized Desktop v1 hosts use their existing same-window external-navigation handoff to the system browser instead of a popup; web hosts retain a new tab. If nothing opens, select and copy the displayed verification address into your browser. The plugin cannot confirm that the system browser opened.
3. Copy the code, open the verification link, and complete authorization in your own GitHub browser session. Copy success/failure is announced accessibly; manual copying remains available. Never paste a GitHub token into DSH.
4. DSH polls only while authorization is in flight. Successful explicit **Start sign-in** (the **Sign in with GitHub** button), including a UI account switch, forces exactly one bounded discovery after immediate or polled success. The code and verification link clear, the automatic authorization area closes, and the account shows **Signed in** and **Manage**. Manually opened details stay open; cancellation clears the old code and errors remain visible.
5. Choose an accepted model under **GitHub Copilot** (stable route ID `github-copilot-preview`). Normal opening/use maintains metadata without requiring **Refresh models**. **Manage** contains the optional manual refresh, model details and sign-out. The compatibility disclosure is removed; legacy configuration diagnostics and explicit repair remain available when needed, and the [migration guide](./docs/single-route-migration.md) remains in the documentation. Errors remain visible with **Retry**, including when details are collapsed; neither discovery nor retry changes your current/default model or replays messages.

One shared account-state owner survives transfer while another eligible surface remains mounted. Last-surface unmount or nonoverlapping declaration replacement stops polling; a later mount reads status and separately ensures metadata if needed. Status reads and details toggles themselves remain network-free, but opening Models can discover missing/stale signed-in metadata. Background credential/reset notifications clear Client state and read status rather than forcing discovery on every token event; the next open/use ensures metadata.

Concurrent status retries join the compact account's pending read. An obsolete read must settle before that controller reads for a new lifetime; Remote has no cancellation contract, so a permanently hung read still needs connection recovery. Authorization polling backs off from 500 ms to 1 s and then 2 s (32 reads in the first minute with immediate replies). Status errors stop polling and expose an explicit retry; sign-in, cancellation and other mutations are never automatically replayed. Credential invalidation and the bounded initial metadata check retain their existing behavior. These are plugin request-pressure safeguards, not a fix for incompatible Agent presets or Core-wide request scheduling.

The public provider-card slot is additive: it cannot replace Core's **Edit/Delete** controls. The native editor remains available, but normal plugin discovery needs no manual model definitions. Embedding the controls does not merge `github-copilot` with `github-copilot-preview`, remove configuration, rewrite history or change model selection. If controls are missing from both eligible card and fallback, verify the active profile and loaded Host/Client version.

**Timestamp illustration (`0.4.0-alpha.7`):** the retained images show that built Client in isolated Edge with synthetic Remote replies and a provider-shell fixture. They do not prove alpha.8 session/search isolation, the Add warning, or a completed route migration; no visual redesign is claimed beyond the new draft warning. The normal header shows sign-in status, model count, last successful update time and **Manage**; manual **Refresh models** appears only inside **Manage**. The browser fixture covered retained stale counts during refresh, status-only fresh reopen, manual refresh, Retry, credential clearing, forced login discovery and a 375 px viewport, with no external network requests or browser errors. This is not live Core/production authorization evidence; Host 24-hour TTL and cooldown timing are covered separately by unit tests, not these screenshots.

The subdued **Updated … ago** timestamp uses the last successful model snapshot, not the time the page opened. Its tooltip and accessible label provide the complete local date/time and time zone. Display text updates locally as time passes without fetching status or models. Refresh/failure retains the previous successful time while that account's display evidence remains valid; sign-out/account invalidation clears it. Missing or invalid timestamps are hidden; future clock values use an absolute date instead of a misleading age. Manage does not repeat the timestamp.

![Alpha.7 signed-in provider with model count, last successful update time and Manage](./docs/images/copilot-model-freshness.png)

![Alpha.7 provider retains the previous model count and update time while refreshing](./docs/images/copilot-model-refreshing.png)

<details>
<summary>Historical alpha.5 and alpha.3 illustrations</summary>

The alpha.5 provider PNGs below show the previous built Client in isolated Edge with synthetic Remote/provider-shell fixtures, not the current refresh layout.

![Alpha.5 account controls embedded in one GitHub Copilot provider row; synthetic fixture](./docs/images/copilot-provider-entry.png)

![Alpha.5 embedded authorization controls with a nonfunctional example device code](./docs/images/copilot-provider-authorization.png)

**Historical illustrations (`0.4.0-alpha.3`):** the animation and older screenshots below show the earlier standalone fixture, not the provider-integrated layout. The old animation shows **Sign in → Copy code → Copied → Signed in → Refresh models → Metadata ready**. Actual GitHub authorization is a separate user step and was not recorded.

![Previous alpha.3 isolated account fixture: sign-in, copy feedback, and explicit model refresh](./docs/images/github-copilot-auth-flow.gif)

The previous-version previews were recorded in an isolated, network-disabled browser fixture. They are not proof that the planned package version is published, installed or loaded. Authorization and discovery responses are synthetic; `ABCD-EFGH` is not a usable code. No real sign-in, sign-out, model refresh, credential change, or route migration was performed for recording, and no production cookies or browser storage were reused.

Previous-version device-code illustration:

![Previous alpha.3 isolated account fixture awaiting authorization with a synthetic code and Copy code button](./docs/images/copilot-device-code-copy.png)

Previous-version signed-in illustration (the current UI additionally performs the one bounded discovery after this user's successful Start sign-in):

![Previous alpha.3 isolated account fixture after sign-in, with explicit model refresh and no device code](./docs/images/copilot-auth-card-signed-in.png)

</details>

### Agent and automation flow

Agents should treat the browser authorization as a human handoff, not as a token-acquisition task:

1. Install the pinned release into the requested profile and restart/reload that profile when required.
2. Direct the user to **Settings → Models → GitHub Copilot → Sign in with GitHub**.
3. Tell the user to open the displayed verification URL and enter the displayed one-time code. Do not ask for, read, copy, log, or persist the user's GitHub token.
4. Wait for the user to complete the browser step. Do not repeatedly start new authorization attempts while one is in flight.
5. Confirm **Signed in** and inspect the automatic discovery result before asking the user to choose a model. Already-signed-in Models opening ensures missing/stale metadata automatically; fresh ready cache makes no request. Use visible **Retry** for errors or **Manage → Refresh models** for an intentional forced update, not routine setup. Status alone does not discover, and login, metadata and successful model calls remain separate evidence.
6. Use **Sign out** only when the user explicitly asks to disconnect the account. It deletes the Copilot credential record but preserves route settings.

GitHub Releases and npm are the default distribution channels for each new version, using the same verified tarball. Pin the version and verify the evidence for the channel used: Release `SHA256SUMS`, and npm `dist.integrity` when installing from npm. The native Desktop package manager is preferred when permitted registry access is available; after npm publication is verified it accepts `dsh-github-copilot@0.4.0-alpha.37`, not a URL or file. Desktop-managed profiles also support explicitly approved [controlled offline CLI maintenance](./docs/npm-distribution.md#controlled-offline-cli-maintenance) with a verified local Release and `--offline --ignore-scripts`. Follow the mandatory search-composition preflight, backup, single-writer and post-install checks; do not bypass a corporate registry ban, disable TLS verification or restart without separate approval. Offline installation is not proof that npm networking/publication was repaired. See [distribution and publication requirements](./docs/npm-distribution.md).

No `copilot2api` process, external gateway, placeholder API key, pasted GitHub token, or separate `dsh-web-search-provider` installation is required.

## What this package owns

- A conditional authorization-service fallback for profiles such as rc.2 that omit Core's service.
- Account controls embedded in an existing canonical Models provider card, with a shared-state footer/old-Core section fallback, Client-safe Remote descriptors, and Host authorization controller.
- Strict normalization of pi-ai's provider-owned Copilot OAuth grant.
- Preservation of intentional canonical-route absence, compatibility repair of existing legacy profiles, and restoration of verified old overrides. It never automatically removes user profiles or replaces Core's model list from another pi catalog.
- A data-driven account-model route using pi `0.85.1`, authenticated Copilot metadata, and the published native DSH adapter. New model IDs do not require a model-specific code patch when their advertised protocol and capabilities are supported.
- Direct provider-hosted search through inline agent-loop interception and a Responses-only `ctx.web` provider.

DSH Core continues to own model selection, sandboxing, tools, attachments, and other providers. `@deepseek-ai/dsh-llm-pi-ai` owns the Copilot adapter, catalog, OAuth method and grant format, token exchange, refresh, and normal model transport. Credentials remain Host-only.

## Retired planner / executor experience

Since `0.4.0-alpha.34`, **Model roles**, its legacy **Copilot · Model roles** fallback, the planning/execution selectors and the dedicated-session creation button are retired (#158). Use ordinary Sessions and Core-owned model selection/subagents; this plugin adds no replacement role UI or automatic model mapping.

Parent-model → subagent-model rules and their native settings UI are separate, still-pending work in [Core PR #95](https://github.com/cloga/deepseek-harness/pull/95). Removing this plugin UI does not make those rules available on older or currently installed Core versions, and does not depend on that PR shipping.

Existing dedicated histories and captured policies remain supported through the retained compatibility runtime, without conversion or model substitution. Saved legacy settings are not deleted or migrated. Legacy Remote clients receive `DUAL_MODEL_RETIRED` for settings writes and new roots; recovery of an already-created matching request remains available. See [retirement and compatibility boundaries](./docs/dual-model.md). Publication and runtime activation are separate from this source change.

The plugin's Web search-provider dropdowns use paired application-theme surface/text colors, including unavailable options, so dark mode does not leave pale labels on a white popup. Hosts without those theme tokens use readable system-color fallbacks. Appearance changes do not save or replace search selections; Core owns its model picker.

## Shared account, independent sessions (V3)

One Host-owned Copilot account supplies many account-discovered models. Each explicitly selected or history-backed Session keeps its own model context: search for Session A uses the captured effective request-header/config of initiating Session A (or explicit request `GenerateOptions`), not Session B's choice or a future global default C. Search plans are cached per owner so different-model A/B requests do not reuse or cancel each other's plans. Account metadata remains shared; capability/probe and credential checks still apply.

Cold Chat picker and `/model` `listModels()` calls ensure the shared managed source without opening Settings first. An actual managed search also performs a non-forcing shared ensure before deriving route/model facts. These paths use the same 24-hour maximum TTL and failure cooldown below; no new global current-model or search-status card is added.

**Native selection limit:** public Core `session.selectModel` also saves the future global default. This plugin does not replace that behavior: selecting one Session does not rewrite other selected/history-backed Sessions, but empty Sessions without a selection may still inherit the changed default. Do not promise every unselected Session is immutable.

**Native Add is warning-only:** the new Copilot provider draft warns that saving a native profile adds another real model group, not a second account. Published additive APIs cannot veto native Add or disable **Save**. The native editor remains; this warning is not absolute prevention or enforcement of a single route. Actual one-managed-route deployment requires the separately approved [Ops migration](./docs/single-route-migration.md) after release, not hidden groups or automatic configuration removal.

### Read-only Ops migration readiness (alpha.9)

No-argument Remote `githubCopilot.migrationStatus()` provides fresh live evidence for a separately authorized maintenance operation. Generic `session/list` data can be stale and plugin inventory alone does not identify the loaded version. This separate strict result reports the loaded plugin build's `plugin.name`/`plugin.version`, `protocolVersion: 1`, `observedAt`, capability flags (`agentsList`, `sessionProjections`, `settingsCas`, `providerRegistry`, `defaultSelection`) and completeness flags for sessions/default/routes. Missing capability or incomplete required selection/route evidence is unknown, not permission to migrate. An idle Agent's `activeRequestSelection: null` is expected.

For each live Agent Session it reports `effectiveSelection` and `selectionSource`: pending model projection first, then recorded request-header config, then the current default only for a genuinely empty Session with known projection state. Running Agents also have a separate `activeRequestSelection`: the latest recorded request header, **not proof of an in-flight LLM call**. Route flags distinguish effective native configuration (`nativeConfigured`) from actual native/managed registration. No credential data or full settings/history is returned.

The call does not invoke authorization status or model discovery, access credentials/network, or mutate settings/Sessions. It adds no normal UI or global current-model/search-status card. The seven ordinary authorization Remotes and their codec are unchanged; this eighth Remote has its own `GitHubCopilotMigrationStatus` codec.

**Limits:** `historyScope: live-agents-only` excludes cold stored histories; the operator must acknowledge that those conversations may need explicit model selection later. Build identity and structural capability self-reports do not attest all Desktop/Core bytes. This is not an atomic cross-namespace snapshot; recheck evidence immediately before CAS. The planned `tools/migrate-copilot-managed-route.ps1` in `cloga/dsh-windows-ops` is a separate, post-release **config-only** maintenance command: v1 does not write Session/default selections, inspect cold history, install the plugin, restart DSH, or certify a full Desktop baseline. Its publication/installation and any live migration remain separate evidence, not a claim made by this document.

## Authorization and route behavior

`llm-pi-ai` registers the OAuth method; the authorization service orchestrates the interaction; this package contributes the UI/Remote controller and route reconciliation. Core supplies authorization on rc.1. On rc.2 profiles that omit it, this package mounts its runtime dependency and reuses any provider already present.

New installations without a canonical profile use the account-discovered route displayed as **GitHub Copilot**, with the unchanged actual ID `github-copilot-preview`. Account controls use an existing configured canonical provider card when mounted; otherwise the footer/old-Core section provides the same flow. Exactly one bounded `/models` discovery follows this UI user's successful Start sign-in, and **Refresh models** remains available for explicit updates. Neither UI placement nor discovery changes a session, default, history, credential ownership or route configuration automatically.

An existing Core-owned `github-copilot` profile is preserved, so upgrades can still show two real routes until the user completes [explicit single-route migration](./docs/single-route-migration.md). This is not a UI filter or facade. After actual removal of the reviewed legacy profile, both the composer picker and `/model` receive only the managed Copilot group. Old conversations remain stored unchanged, but a paused conversation still selecting the removed canonical route needs an explicit managed model selection when resumed.

The managed route selects Responses, Chat Completions or Anthropic Messages from advertised `supported_endpoints`, not model names or a per-model allowlist. An existing pi protocol is retained only if the server also advertises it. New IDs with complete supported metadata can therefore work without another plugin release. Missing endpoints, disabled policy, unsupported protocols or malformed limits produce explicit diagnostics rather than guesses. Updating pi or seeing a model ID in its catalog does not itself prove the protocol is correct.

### Automatic model freshness

Opening Models separately calls non-forcing Remote `githubCopilot.ensureModels()` once for signed-in metadata that is missing, idle, stale, errored or loading. Reopening an error may retry after the shared failure cooldown, without a same-mount retry loop; loading joins the existing Host flight to observe completion, not another network request. Fresh ready metadata does not fetch, and a genuine `unavailable` result with no models does not automatically retry. Normal model use also ensures freshness. The Host shares one in-flight discovery across callers, with no periodic refresh timer. The configurable defaults are **24 hours** maximum metadata reuse (`accountModelTtlMs: 86400000`) and a **5-minute** failure cooldown (`accountModelFailureCooldownMs: 300000`). Explicit successful UI sign-in/account switch forces discovery once; manual **Manage → Refresh models** and visible **Retry** remain available.

Last known same-account metadata may remain visible during TTL refresh/loading/error, but that display never authorizes a request. Credential/account/permission invalidation or proof expiry immediately revokes old request evidence; 24 hours is a maximum metadata reuse window, not an OAuth-token extension. Background credential/reset events clear Client state and read status, without forcing a discovery on every token event; next open/use ensures metadata. Status and details toggles themselves stay read-only and network-free.

Before issuing a new metadata lease, the managed route uses a **5-minute-30-second preflight renewal threshold**: the native SDK's five-minute renewal window plus a thirty-second preparation margin. Metadata preparation consumes this margin; it is not a promise of that much validity remaining at the later lease or wire boundary. A reusable warm snapshot inside that window is retired, and the existing single-flight discovery resolves native OAuth and validates fresh metadata before preparing the model call. Other callers join that flight; it does not force past failure cooldown. Native `Models.getAuth()` receives the same minimum-validity budget, so an insufficiently renewed token fails before model dispatch rather than causing a refresh loop. Status reads remain network-free. This fixes a warm-cache path that could produce `OAuth auth derivation failed ... COPILOT_PREVIEW_METADATA_STALE` during the request's own refresh. The UI's **Updated** timestamp is metadata freshness, not the OAuth refresh timestamp. Credentials, permissions and endpoints are still checked; an already-prepared call that later crosses the renewal boundary or loses its proof still fails closed without automatically replaying the message. Hosted-search continuity/probe gates remain independent and may reject that attempt after a credential notification.

A definitive `UNKNOWN_MODEL` result triggers one bounded metadata refresh, not a replay of the failed message or an automatic model switch. Generic HTTP/network failures are not guessed to mean an unknown model. Account/token/permission generation checks reject stale results; discovery never copies credentials or rewrites selections/history. A server-enabled new model may precede an older grant's cached ID list without rewriting that grant.

**Plugin-only development boundary:** fixes in this project must use existing published public APIs and remain in the plugin. Do not patch Core source, installed binaries, `node_modules`, private runtime registries or shared upstream catalogs; do not make a new Core export or upstream Core PR a delivery prerequisite. Read-only inspection and isolated verification against unchanged pinned Core artifacts are allowed. If a stock API cannot support a requested feature, state the limitation and use a tested plugin-local alternative rather than changing Core. The authoritative policy and its machine checks are documented in [AGENTS.md](./AGENTS.md#plugin-only-implementation-boundary).

Keep `llm-pi-ai` mounted: its OAuth method and the unique Host-only `llm-pi-ai/github-copilot` credential remain the authentication owner even without a canonical model profile. Do not sign out, remove the authorization plugin or copy credentials to hide a route. Model metadata from another dependency copy is not proof that actual Core supports that model or protocol.

The plugin does not install a global Responses override or recreate a missing canonical profile on login, startup or token refresh. Existing canonical profiles retain their models, protocol, headers and custom fields; normal legacy reconciliation changes only `compat.supportsStrictMode: false`. Removing such a profile requires explicit migration, not an automatic upgrade side effect. The managed route obtains supported protocols from account metadata and does not fall back to a static catalog when discovery fails.

Previously installed plugin overrides are restored only through a verified ownership journal, to the recorded original `api`/`models` values. Owned public headers are removed only if their values still match. User edits, ambiguous legacy markers and interrupted uncommitted writes remain conflicts rather than being forcibly adopted. Restoring an absent or empty model list returns Core to its default catalog; it does not mean an empty set of models.

Temporary ownership uses a bounded version-2 journal: raw `api`/`models` preimage and postimage, prepared restoration target, namespace revision and process epoch. Only fixed public Copilot headers can enter the journal; arbitrary header values, credential payloads and custom model extras are never copied into it. Every write uses the namespace revision; current owned fields must still match the recorded values. Conflicts retain the journal and user edits instead of guessing ownership. Deleting a created profile additionally requires its complete raw shape to be plugin-owned, with no base profile, user additions or set secrets. Normal reconciliation merges actual raw user extras only, not schema defaults. These checks are conservative recovery safeguards, not an atomic transaction across settings namespaces and credential storage.

**Upgrade boundary:** older backups without postimages/epoch are reported as `conflict`, not automatically adopted. Review the existing route and backup before explicitly migrating or removing the marker; do not reconnect or delete it to force ownership. A later invocation never replays a prepared but uncommitted activation/restoration automatically: Core revision counters reset on namespace re-registration as well as restart, and there is no public durable registration identity. Even matching recorded epoch/revision is not enough to prove ownership across that boundary. Steady owned postimages can begin a fresh restoration, and already-restored targets can clear their journal without replaying writes. An existing recorded restoration target that differs from the original preimage remains a conflict for explicit review; a new account model set never authorizes overwriting that evidence. Remove legacy connection fields explicitly during migration. Sign-out itself still deletes only the `llm-pi-ai/github-copilot` credential record and keeps route settings.

### Read-only status and explicit repair

`githubCopilot.status()` and Host `describeGitHubCopilotProviderProfile()` only read stored state and plan legacy canonical changes. They do not write settings, refresh OAuth or test the network. Status separates configured authentication from legacy route states `ready`, `needs-repair`, `not-configured`, `conflict` and `error`. With valid login, `route: not-configured` normally means the optional canonical profile is absent: it is not a login error or a repair request, and it does not prove managed discovery is ready. `ready` only means the inspected canonical configuration needs no repair. Discovery and successful model/search calls remain separate evidence.

Use **Repair model configuration** (Remote `githubCopilot.reconcile()`) for an explicit, revision-checked repair of an existing legacy profile or verified journal. It does not fetch a model list, create an absent profile, or force conflicts. Successful login, startup and auth-refresh reconciliation also preserve absence. Browser status polling is read-only; the UI separately initiates its one discovery when this user's Start sign-in succeeds. Deploy matching Host and Client bundles.

Before a grant is persisted or reused, the Host normalizer rebuilds only pi-ai's documented `type`, `refresh`, `access`, finite `expires`, optional `enterpriseUrl`, and optional deduplicated `availableModelIds` fields into a fresh plain JSON object.

## Hosted search

Auto-mode native search identity comes from the captured initiating Session's effective request-header/config or explicit `GenerateOptions`, never the future global chat default. Fixed/fallback Copilot search instead resolves its execution model inside the provider from current account metadata, while preserving a nonempty explicit `github-copilot.searchModel` override; it never borrows the Chat model or another Session's selection. Core `Agent.options` remains the activation seed: model selection overrides request/assembly, with effective config recorded in `Session.requestHeader().config` before tools. Without a proven initiating owner, traditional search is unavailable. After a new model is selected but before its next request, the previous header must not be treated as current prompt guidance. Per-owner plan caches keep different-model Sessions independent. An actual cold managed search first ensures the shared account metadata without force, then derives model facts and applies the existing account/protocol/allowlist/probe gates. Explicit marked `GenerateOptions` can still bind eligible inline requests, uncached when no owner is available, under all existing guards.

**Credential-change limit:** an OAuth notification during initial lazy metadata discovery cannot distinguish the discovery's own token rotation from an external account change through current public status. That first search deliberately fails closed with `WEB_PROVIDER_UNAVAILABLE`, before probe/wire work. A later user/driver request may retry with refreshed credentials; there is no automatic retry or promise of seamless first-attempt refresh.

- **Managed-route conversations:** `github-copilot-preview` uses the native adapter, not the custom inline wire; this preserves account evidence, replay and attachment handling.
- **`github-copilot-hosted` through `ctx.web.search()`:** supports account-authorized OpenAI Responses candidates, including the single managed route. Ordinary chat success is not search capability proof.
- **Legacy canonical inline agent-loop path:** eligible `github-copilot` requests support Responses or Anthropic Messages native-search candidates only while that legacy route remains configured.
- **Chat Completions models:** remain usable through normal native transport but do not advertise hosted search.

### Session-aware search routing (implementation awaiting release)

The bundle composes a plugin-owned web-service facade while preserving the original official service and its exact configuration in a named realm. It does not edit Core or agent presets. Native `web_search` consumers keep their argument validation, query/source limits, middleware, timeout and presentation; the same routing also covers direct `ctx.web.search` consumers with proven initiating context.

A separate **Web search** card under **Settings → Models** controls routing across search backends. On older Core versions without the Models footer, it appears as **Settings → Web search**. The companion owns the namespaced policy (`github-copilot-search-routing`); it does not claim a global Core namespace. Removing the companion restores the original web service.

The **Search provider** selector offers **Auto — follow Chat** and the actual search providers registered through the routed facade. **Fallback provider** uses the same catalog, with an additional **None — no fallback** choice. These are search backends, not individual models: Copilot is one backend even when different account models can execute its search requests. Ordinary setup needs only these provider choices, not a separate search model.

- `github-copilot-search-routing.searchProvider: auto` follows the initiating Chat provider. Copilot's plugin-owned aliases retain their existing ownership and model-capability checks; other Chat provider IDs must exactly match a registered search provider ID. Names, suffixes and model families are never guessed. This convention does not promise the same model or account across independently registered providers.
- A concrete `searchProvider` ID pins the primary backend independently of Chat.
- `defaultSearchProvider` is only the final fallback when no primary matches or the primary search fails. It is attempted at most once, never retried when it is already the primary, and never replaces a successful empty result. `none` disables fallback without disabling the primary.
- Copilot selected explicitly or as the fallback automatically considers at most three eligible Responses candidates from current account route facts, sorted by model ID. The default capability probe must succeed before the final user query is sent once; metadata alone is not proof, and a failed final query is not replayed across models. This internal selection does not change Chat or global defaults. Other backends own their model configuration, if any.
- A saved nonempty `github-copilot.searchModel` remains authoritative; the plugin does not silently replace an invalid override. Its read-only details offer a separate explicit reset to automatic selection (`searchModel: ''`). Saving provider routing never changes this override.

Existing `searchMode: auto/fixed` settings remain readable without automatic writes. Legacy fixed mode preserves its old default as the primary; fixed plus `none` stays disabled. An explicit save writes both routing keys together with one revision-checked mutation; it does not require the Copilot settings namespace or fetch an account/model list. Stable Remote references keep enclosing page renders from resetting the draft. On a revision conflict, reload saved settings and reapply the intended choices; a rejected or unconfirmed response is not reported as success. Saving proves only configuration persistence, not live search capability. The UI explains that saving adopts the chosen final fallback, including possible API charges; legacy `github-copilot.searchFallback: none` failure-spending restrictions remain until that choice is saved. Unregistered saved IDs remain visible as unavailable instead of being silently substituted.

`github-copilot.routeWebSearch: false` still delegates to the original configured web service. Otherwise cancellation, unload and captured account-proof invalidation never authorize a fallback. Generic registered backends must honor cancellation; their public interface does not expose an internal pre-network authorization hook. The historical direct Copilot/DeepSeek path retains its stronger owned pre-dispatch guard. Neither path supplies another provider's credentials from Copilot sign-in.

The catalog contains registrations observed by this facade, not hidden registrations made directly in another realm. Listing it does not call availability checks, model discovery, credentials or search; actual usability is checked for each request. No static list of example providers is presented as installed support. Custom/nonstandard web compositions still require review. Fetch is unchanged. See [implementation and evidence limits](docs/session-search-routing.md).

Requests go directly to the credential-resolved HTTPS Copilot endpoint after strict host validation: GitHub-hosted `api.*.githubcopilot.com`, or `copilot-api.<signed-in-enterprise-domain>` for an accepted GitHub Enterprise credential. No external gateway receives the credential.

By default (`probe: true`), search fails closed unless the selected route is canonical `github-copilot` or the plugin-owned `github-copilot-preview`, the account authorizes the model, its verified protocol supports native search, and a bounded capability probe succeeds. Managed-model conversations always use their native adapter; independent Responses `ctx.web` search uses account-bound authorization without the old static-catalog ID restriction. Setting `probe: false` bypasses only capability proof and trusts the selected native protocol; route, account, protocol, endpoint, and authentication checks remain active. The underlying hosted-search provider does not itself fall back. The routed facade may apply the explicitly selected final fallback for eligible failures; aborts and invalidated owner/account proofs remain terminal. Requests containing any Core file block—including files nested in tool-result content—also fail closed to `next()`, preserving Core's file projection instead of letting the hosted-search serializer drop that context.

Search proof is lazy: attach, settings updates and `credentials/record-updated` for `llm-pi-ai/github-copilot` only invalidate cached plans, without starting network work. The next actual eligible request proves capability again; unrelated credentials are ignored and event bursts do not trigger repeated eager probes. In-flight proofs are cancelled on invalidation/disposal. If credentials change during proof or final auth resolution, the current request fails closed rather than applying account A's proof to account B. Submit a new request after the update; there is no automatic retry loop or implicit `probe: false` fallback.

## Reasoning summaries and empty Think disclosures

On the eligible custom Responses path, an explicit request reasoning effort overrides the provider profile default. The companion validates it against the selected model's declared/native efforts, maps its wire value, and requests `summary: "auto"`, matching the native pi-ai path. No effort selection leaves provider defaults unchanged; Core's `off` omission is preserved rather than represented as a guaranteed server-side disable. Unsupported or missing model metadata fails with a named error before the custom model request; the separate capability probe retains its existing lifecycle.

The Responses parser preserves public `reasoning_summary_text` and `reasoning_text` events, final-only summaries, and interleaved parts without repeating delta text from completion snapshots. Empty or encrypted-only items do not become fabricated explanations. Some Copilot Responses requests still return encrypted reasoning without public text: [summaries are optional](https://developers.openai.com/api/docs/guides/reasoning), and requesting one does not guarantee it. The companion never decrypts or invents reasoning.

Requests whose assistant history contains reasoning blocks or opaque `replayState` bypass the custom wire through Core **before probing**. A public summary must not be reconstructed as a raw `reasoning_text` input item, and encrypted replay belongs to Core. This deliberately limits inline search on such histories; the separate Responses-only `ctx.web` provider remains available under its usual route/probe gates.

On the guarded Chat rendering contract, the Client hides completed, empty or whitespace-only reasoning disclosures for replies whose own recorded provider is `github-copilot` or `github-copilot-preview`, for any valid model ID. It delegates the remaining view to DSH's native renderer. Nonempty summaries, answers, tools, images and actions remain unchanged. Running or interrupted steps, unknown provenance, and non-Copilot replies retain their native rendering; selecting a different model later does not reclassify historical replies. Because this runs on the rendered view rather than the search transport, it also covers native/image request paths and loaded history when the necessary provenance is present.

Filtering changes only temporary render props. Durable messages, encrypted signatures, replay-state block indexes and token usage are not rewritten, so future requests retain the original reasoning context. There is no DOM polling or whole-page observer. Removing the plugin withdraws the contribution and restores native rendering.

This optional integration uses the public `conversation.chat.node` keyed slot and `uiConversation` location data. Its guard checks the current plain memo renderer named `AssistantNodeView`; renamed/minified future renderers are left alone. This is a compatibility check, not module-ownership or security proof: a deliberate replacement with identical naming and metadata cannot be distinguished through this registry. It does not block authorization on older Cores. Missing or incompatible extension contracts, or a competing assistant renderer, leave native output unchanged with a named compatibility diagnostic. The new display behavior is not a claim of live GPT-6 transport success; unsupported Core versions may still show empty Think rows. It does not change the `github-copilot.enabled` setting, which controls hosted search only.

### Capability warnings and adapter limits

- `REASONING_EFFORTS_UNSUPPORTED` means some advertised reasoning labels cannot be expressed faithfully by the selected native SDK protocol. They are not guessed, and ordinary requests remain available. Explicit unsupported efforts—including an unadvertised `off`—are rejected rather than silently treated as defaults.
- `INPUT_LIMIT_ESTIMATED_GUARD` means the managed route applies a plugin-owned estimated input guard while retaining the provider's distinct input, context and output capacities. This is not exact provider token counting or a claim that Core exposes a separate input limit; provider overflow remains possible.
- The Core-facing integration uses the published adapter's normal `streamSimple` path. Its advanced `stream` entry explicitly rejects incompatible protocol-specific SDK client objects; this does not disable normal conversation streaming.
- Unknown pricing is represented as unpriced metadata, not a claim that a model is free. Public summaries remain optional provider output.

## Managed request budgets and compaction

The managed `github-copilot-preview` route estimates the complete native request, including current system/tool prefixes, and checks both the independent prompt limit and combined input/output capacity before model transport. Its operational input budget is `min(prompt limit when advertised, context capacity - requested/default output reservation) - safety allowance`. Supplier capacities are not rewritten. Invalid output policy or exhausted headroom fails explicitly; no history is silently truncated and no model is substituted.

For a marked ordinary agent-loop request with a matching initiating Session and committed request configuration, optional token-meter and enabled stock automatic compaction, the plugin signals local estimated pressure at 90% of that budget. Core owns the existing bounded compaction/rebuild path and commits only a valid smaller checkpoint. It does not compact concurrently inside a frozen request. Missing optional seams disable this early signal, not the final native budget guard; `auto: false` or zero stock overflow retries remain respected. Canonical/user-owned routes and other providers are unchanged.

Calls explicitly marked `purpose: 'compaction'` bypass the early-pressure signal and use the full hard budget. When no caller or adapter-resolved reasoning effort is present, `prefer-low` selects an advertised supported `minimal` or `low` effort; unsupported controls preserve provider defaults. An explicit or materialized effort wins. The requested summary output cap remains unchanged, preserving Core's auxiliary summary record; the plugin does not blindly raise/lower it or accept truncated output as a checkpoint. `enabled` remains a hosted-search switch, not a switch for this managed-route protection.

**Existing oversized history is not guaranteed recoverable.** Manual compact can still exceed the hard budget and is rejected before model transport with a safe diagnostic. Output truncation remains a distinct native `max-tokens` outcome. This change adds no chunked summarizer, silent history deletion, automatic model switching or new retry loop. Configure an appropriate summary route/cap through official compaction policy when needed; do not repeatedly resubmit an unchanged impossible request. See [the implementation and acceptance boundary](./docs/copilot-compaction.md).

## Copilot tool compatibility

To prevent observed invalid Copilot tool payloads, the package sets the managed route's `compat.supportsStrictMode` leaf to `false` and applies two schema-only fixes when the selected provider is canonical `github-copilot` or the plugin-owned account route `github-copilot-preview`: it removes top-level `sandbox_permissions` and `justification` properties, and rewrites Core's multi-action `update_goal` parameters as a discriminated `oneOf`. Each Goal action then advertises only its legal fields: `complete`, `pause`, and `resume` cannot carry edit or blocker fields; `blocked` requires `blocked_reason`; and `edit` alone exposes replacement fields. Execution still uses Core's original Goal tool and service. Non-Copilot prompt assemblies are unchanged.

Copilot sessions that need wider file or command access must select sufficient standing permissions before the call. Installation agents must also follow these payload rules:

- Omit `sandbox_permissions` and `justification` on initial `pwsh` calls.
- Never emit them when approval prompts are disabled or the current mode is already `danger-full-access`.
- Use them only for the single exact-command retry allowed after a real sandbox denial when approval is available and the requested mode is wider.
- Omit the keys entirely rather than sending null, empty, or current-mode values.

The plugin does not rewrite `$DSH_HOME/AGENTS.md`. Installers may merge these rules into user instructions only with explicit user consent.

## Settings

The plugin's `github-copilot` settings section controls account-metadata freshness, managed request budgets and hosted search. `enabled` still controls hosted search only:

| Key | Default | Scope and meaning |
|---|---:|---|
| `accountModelTtlMs` | `86400000` | Maximum account-metadata reuse window in milliseconds (24h); does not extend credentials or proof validity. |
| `accountModelFailureCooldownMs` | `300000` | Failure cooldown in milliseconds (5min) for non-forcing discovery; no periodic retries. |
| `requestBudgetSafetyTokens` | `4096` | Non-negative safe-integer estimated input allowance; larger values reduce available input. |
| `requestBudgetPressureRatio` | `0.9` | Fraction (0.01–1, step 0.01) for early local pressure, only with supported enabled stock recovery. |
| `compactionReasoning` | `prefer-low` | Choose supported minimal/low only when summary effort is absent; `preserve` keeps native defaults. |
| `enabled` | `true` | Enable both hosted-search surfaces. |
| `providers` | `[]` | Optional route allowlist for both surfaces; empty follows the initiating route. Existing nonempty lists are preserved; Ops must explicitly review any legacy-ID change to `github-copilot-preview`. |
| `includeSources` | `true` | Request provider citations on the inline path. The `ctx.web` bridge always requests and returns sources. |
| `stripServerTools` | `true` | On the inline path, remove local function variants of provider-hosted search tools. |
| `idleTimeoutMs` | `300000` | Inline stream idle timeout and `ctx.web` request deadline, in milliseconds. |
| `probe` | `true` | Require capability proof on both surfaces; `false` explicitly trusts the native protocol. |
| `probeTimeoutMs` | `30000` | Whole capability-probe deadline, in milliseconds. |

There are no credential-token, API-key, model-catalog, or endpoint settings in this package.

## Migration and troubleshooting

Existing installations must follow the [single-route migration guide](./docs/single-route-migration.md) before removing a native profile. The plugin does not migrate defaults, presets, active sessions or history for you. Old gateway routes and `COPILOT_GITHUB_TOKEN`-style references are not required; review them separately rather than deleting unrelated user configuration.

- **No sign-in control:** confirm the package is loaded in the active profile and use the baseline-specific UI above. Do not add a native provider just to reveal login.
- **Two Copilot groups after upgrade:** a legacy canonical profile is still configured; it is preserved deliberately. After explicit migration/removal, both composer and `/model` list only the managed group. There is no display-only alias masking a second route.
- **Signed in but a new model is missing:** opening Models ensures missing/stale metadata automatically; inspect accepted/rejected models for `github-copilot-preview`. Use **Retry** after errors or **Manage → Refresh models** to intentionally refresh before the TTL expires. Unsupported endpoints or incomplete metadata produce diagnostics, not static-catalog fallback. Do not repeat login or disable validation.
- **`AUTH` / “API key is invalid” after signing in again:** this label does not prove the conversation cached an old key. On the managed route, an observed model HTTP 401 retires only the exact current token proof, except the narrowly recognized Responses replay-scope rejection described below. The failed request stays failed: no automatic message replay, logout or model switch. Your next request (or model discovery) can perform one native OAuth renewal even before stored expiry, then validate account metadata. Repeated rejection is bounded per account by `accountModelFailureCooldownMs` (five minutes by default, at least one second); even forced discovery cannot bypass this recovery cooldown. If the renewed token is still rejected, wait for the cooldown and inspect account/permission status rather than repeatedly signing out. A new sign-in is not overwritten by a late old response. HTTP 403, network errors and strings mentioning 401 do not trigger this recovery. It observes native HTTP transport only; WebSocket recovery and live endpoint acceptance are not claimed.
- **`input item ID does not belong to this connection` / `input item does not belong to this connection`:** these are the two observed Responses history-reference rejection messages, not proof of an invalid API key. On `github-copilot-preview` only, a bounded clone of the actual HTTP 401 JSON identifies these exact uncoded errors, with matching outer/nested messages; the plugin reports `INVALID_REQUEST` with `COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH` without retiring shared account proof, aborting neighboring calls, renewing credentials or retrying the request. Unknown, malformed, oversized or ambiguous error bodies retain native authentication handling. Historical error records are not rewritten.
- **Managed Responses replay compatibility:** the public SDK `onPayload` hook normalizes only direct item IDs on complete assistant messages, function calls and reasoning items carrying encrypted content. It preserves `call_id` pairing, encrypted bytes, public summaries, `phase`, nested IDs and durable history. Reference-only, incomplete or unsupported ID-bearing items fail explicitly with `COPILOT_RESPONSES_REPLAY_UNSUPPORTED`; no hidden history trimming or model switch occurs. This is Copilot-specific, not a universal OpenAI schema change: public OpenAI types require IDs on some replay forms. Native SDK/pinned-Core synthetic tests verify transport shape and isolation, not real Copilot acceptance of an old conversation. Canonical `github-copilot`, other providers and non-Responses protocols are unchanged; install/activation and old-session endpoint acceptance require separate review.
- **Scope rejection persists after alpha.36:** its original exact-message classifier missed the observed wording without `ID`. Alpha.37 only closes that classification/isolation gap; it does not further rewrite payloads or prove that the rejected history can be replayed. The parallel-request failure is reproduced with the native adapter in a fixture that does not load cron. This establishes a companion error-handling defect, not the upstream reason for rejecting the original item. `Request aborted` alone does not identify its cause; `COPILOT_MODEL_SOURCE_AUTH_FAILED` is a generalized pre-catalog auth-resolution failure, whose cached result may recur without another auth attempt. Compare actual loaded version, request provenance and the same history/model before attributing another machine's success to a plugin downgrade or cron removal. Do not silently discard encrypted reasoning, retry old business work or reset credentials.
- **Canonical route says `not-configured`:** with configured login this is normal managed-only mode; inspect account discovery separately rather than creating a native profile.
- **Delete dialog stays on “Deleting…”:** this update does not prove that hang fixed. Do not repeatedly delete; after an authorized Host stop, inspect persisted settings and follow the migration guide before deciding whether any removal is still needed.
- **No Think text:** the provider may omit public summaries, but nonempty summaries must survive the Responses parser. Check selected effort and named errors. Empty disclosures are hidden only after completion; encrypted replay is never displayed. Reasoning/replay-bearing histories use native Core transport.
- **Hosted search unavailable:** for explicit/fallback Copilot, inspect account discovery/probe diagnostics; ordinary setup no longer requires selecting a search model. A legacy override remains authoritative until you explicitly reset it to automatic selection. Auto following Copilot Chat still requires that initiating model to support search. The custom inline path is legacy-canonical only; a saved provider choice or normal managed chat success does not prove search support.
- **Legacy endpoint/key still present:** reconciliation preserves unowned fields by design. Review explicit migration; never force-remove an ownership marker.

## Package entries and source map

Public exports are `.`, `./client`, `./remote`, `./deployment-baseline.json`, and `./package.json`.

- `src/index.ts`: authorization bootstrap, dependency-gated Host composition, settings, inline interception, and `ctx.web` registration.
- `src/authorization-controller.ts`: Host authorization and path-level route reconciliation.
- `src/copilot-grant.ts`, `src/copilot-auth.ts`: grant normalization and Host credential lifecycle.
- `src/client.ts`, `src/remote.ts`: Models UI and Client-safe Remote contract.
- `src/account-model-catalog.ts`, `src/account-model-source.ts`, `src/account-model-auth.ts`: bounded account discovery, endpoint/capability normalization and native OAuth binding.
- `src/preview-route.ts`, `src/preview-provider.ts`, `src/pi-provider-bridge.ts`: data-driven account models and the public native adapter/SDK boundary.
- `src/current-provider.ts`, `src/plan.ts`, `src/probe.ts`: owned route facts, candidate planning and capability proof.
- `src/temporary-models.ts`, `src/route-ownership.ts`: recognition and conservative restoration of historical configuration writes; not a new-model routing table.
- `src/model-protocol.ts`: public local facts with explicit ownership limits; no unshipped Core service dependency.
- `src/responses-reasoning.ts`, `src/responses-reasoning-text.ts`: selected-model effort mapping and public summary assembly.
- `src/wire.ts`, `src/wire-anthropic.ts`, `src/traditional-search.ts`: hosted-search transports.
- `deployment-baseline.json`: declared machine-readable compatibility/capability evidence inventory; `scripts/verify-deployment-baseline.mjs` checks its source and test markers for drift.
- `lib/`: generated release output; never edit it directly.

## Build and verify

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
```

Use Node 24 LTS for development and the pinned pnpm version; runtime dependencies require Node >=22.19.0. `pnpm verify` runs the Agent contract check, source and local test typechecking, baseline markers, clean build, Vitest and Node tooling tests, and a real built Host import plus Client/Remote smoke. After packing, run `pnpm verify:tarball -- artifacts/dsh-github-copilot-<package-version>.tgz` to verify archive exports, media, allowed contents and equality to that build. The CI definition targets all nine exact Core sources/config fixtures on Windows and Linux: controlled `0.1.1-rc.2`, `0.1.2-rc.1`, `0.1.3-alpha.1`, official `0.1.5-alpha.1`, `0.1.5-alpha.2`, `0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.6-alpha.1`, and `0.1.6-alpha.2`. All seven tagged-source targets are gated by unchanged tagged-source runtime fixtures; release publication depends on that full matrix. This candidate's CI qualification has not executed; see the alpha.25 evidence limits above.

For the optional reasoning UI integration, `pnpm verify:reasoning-ui -- <Core checkout>` runs a synthetic native-renderer, Slot registry and history-assembly fixture against a clean pinned `0.1.2-rc.1`, `0.1.3-alpha.1`, `0.1.5-alpha.1`, `0.1.5-alpha.2`, `0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.6-alpha.1`, or `0.1.6-alpha.2` checkout with its Chat dependencies installed. It exclusively creates one temporary test file and removes it only if unchanged. This is local integration/static-render evidence, not a live browser or Copilot API test; the CI definition covers all eight supported Chat baselines, without implying this candidate's qualification has run.

### Agent-driven development

From a source checkout, use these read-only entrypoints (no dependencies needed for discovery):

```sh
node scripts/agent.mjs describe --json
node scripts/agent.mjs doctor --json
node scripts/agent.mjs plan models --json
node scripts/agent.mjs attribution "DeepSeek Harness (DSH)"
```

`agent-contract.json` maps authorization, models, search, client, compatibility, tooling and release tasks to owning files and tests. Plans return unexecuted argument arrays, including the exact package-version archive path. Doctor checks repository prerequisites only: exit 0 means preflight passed, 1 means missing prerequisites, 2 means invalid input/metadata. For clean machine-readable output prefer the direct `node` command rather than parsing pnpm progress logs.

Attribution follows the actual tool: `Assisted-by: DeepSeek Harness (DSH)` for DSH-assisted changes, not a Copilot App co-author inferred from the model provider. Keep the human Git author and reserve `Co-authored-by` for verified collaborators. Merge, profile install, sign-out and worktree checkout require explicit approval. Important updates include post-merge release follow-through under the policy below; they do not require another release prompt.

Evidence is layered: package presence/import and passing synthetic tests do not prove live DSH activation, account entitlement, model transport or hosted search. Authorization `status()` is read-only; explicit reconciliation/startup may persist configuration, while capability probes run only on actual eligible requests. None of these reports implies live transport success without a real request. Search resolves captured effective initiating Session request config or explicit request options and keeps per-owner plans instead of deriving them from the future global default; unsupported context still fails closed. Release, Ops migration and registry readback remain separate evidence. See the [readiness audit](./docs/agent-readiness.md) for evidence and remaining limitations.

## Important-update release delivery

Important user-requested features, behavior fixes, compatibility fixes, and security or stability fixes include publication after an authorized merge and green required CI. The agent must continue version preparation, the protected tag/Release workflow and asset verification without waiting for a second request to release. Plan version alignment in the implementation PR where practical; preserve the prerelease channel unless promotion is requested.

An explicit code-only/review-only/do-not-release instruction takes precedence. Documentation-only and internal-only changes do not trigger a release by default. Merge approval is still required, including for a separate version PR; profile installation and session-interrupting restarts remain separate. This is agent delivery policy, not an unconditional publish-on-merge CI trigger.

Report the published Release URL, version, tag/commit and verified asset SHA-256 before calling release delivery complete. If publication is blocked, report the concrete CI/permission/network blocker and pending step rather than treating a merged PR or local build as a release. Full rules are in [AGENTS.md](./AGENTS.md#important-update-release-delivery).

## Release and checksum verification

`package.json` declares public npm distribution. A release tag must equal `v${package.json.version}`. Versions use standard SemVer prerelease labels (`alpha`, `beta`, or `rc`), each with its matching npm dist-tag; only stable versions use `latest`. The Release workflow performs the frozen install and complete verification gate, packs once (or recovers the original archive on retry), verifies `SHA256SUMS`, publishes the immutable GitHub Release and then publishes those same bytes to npm through OIDC. Either channel failing means delivery is incomplete. First package creation needs an authorized maintainer; staging requires an existing package and is not a first-package bootstrap. Historical releases are not republished.

```sh
curl -LO https://github.com/cloga/dsh-github-copilot/releases/download/v0.4.0-alpha.37/dsh-github-copilot-0.4.0-alpha.37.tgz
curl -LO https://github.com/cloga/dsh-github-copilot/releases/download/v0.4.0-alpha.37/SHA256SUMS
sha256sum --check SHA256SUMS
```

PowerShell can verify the same two downloaded files with:

```powershell
$expected = (Get-Content .\SHA256SUMS).Split()[0]
$actual = (Get-FileHash .\dsh-github-copilot-0.4.0-alpha.37.tgz -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -cne $expected) { throw 'Release checksum mismatch' }
```

The checksum detects download corruption or asset drift; repository controls and the protected Release workflow establish publisher provenance. Never move or reuse a release tag. Increment the package and deployment-baseline versions together for every release. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the change workflow and [SECURITY.md](./SECURITY.md) for private vulnerability reporting.
