# Per-session web search (issue #112, implementation in progress)

## Requested behavior

The initiating Session chooses the route, not the global default model. Canonical Copilot and verified plugin-owned `github-copilot-preview` selections prefer Copilot hosted search. DeepSeek and all other providers continue through the existing official web service unchanged. The user permits automatic DeepSeek fallback without per-query confirmation; each fallback identifies the backend, reason and possible DeepSeek API charges. `searchFallback: none` disables fallback. Cancellation, owner disposal and invalidated account proof never authorize a fallback request.

All implementation belongs to this plugin. No Core source, deployed Core artifact, prototype, private registry, credential copy or global model choice is modified. The original official WebRuntime configuration, including its selected search/fetch providers, is preserved.

## Composition

Modern Core may mount `tool-web` in agent presets while disabling its historical Host row. Modifying that disabled row is insufficient. The bundle therefore changes the service composition, not the consumer or preset:

1. An id-and-name-guarded patch moves the existing `web` / `@deepseek-ai/dsh-web` row into the named `github-copilot-original-web` service realm without replacing its config.
2. The plugin's `web-delegate` entry exposes that same official service through a public, Fiber-owned bridge. It does not read any provider registry internals.
3. The plugin-owned `routed-web` service occupies the ordinary Host `web` scope. It forwards provider registration and fetch directly to the original service. Non-Copilot searches use that service's normal selection and execution.
4. Copilot searches use the main plugin's captured initiating-session route, existing hosted-search provider and account-proof lifecycle. A separate private official WebRuntime supplies native request validation and source capping on this branch.
5. Native `tool-web` consumers, including those in agent presets, retain their original schemas, configured query/source limits, batching, execution policies, timeout metadata, formatting and presentation.

This is a plugin-owned subclass and explicit public service composition, not a replacement of Core prototypes or a mutation of a live registered service. It affects all `ctx.web.search` consumers with eligible Copilot context, not only one tool name. The bundle requires the standard enabled top-level official Host `web` row, static provider config and no prior isolation. The patch name guard does not make its separate inserted rows conditional: installing into a custom/missing/disabled/isolated web composition can prevent startup. Run the required read-only `scripts/check-search-composition.mjs` preflight over the existing profile before installing; it uses public readers and composition without calling write-capable `loadProfile` normalization. It excludes the existing owned routing layer for updates and includes profile, home and supplied launcher patches. `dsh plugin add` does not automatically enforce this step. Unsupported shapes must be refused before mutation, not described as safe no-ops.

## Routing and fallback

`src/search-routing.ts` routes one already-validated search using captured provider/model leaves, a verified managed-route ownership flag and operation-local dependencies. It delegates non-Copilot requests without checking Copilot availability, discovery or fallback. Only an explicitly supplied `deepseek-official` provider instance can serve fallback. It never guesses the backend of another dispatcher or substitutes the future default model. Successful empty results do not trigger fallback.

`src/deepseek-search-fallback.ts` lazily constructs the public official `DeepSeekSearchProvider`; the upstream class owns its wire protocol, redirect policy and result parsing. The helper reads the existing `web-search-deepseek` settings, public launch-environment snapshot and credential service at operation time, and records the auxiliary request without auth headers/credential fields on the captured Session. Fallback API bases must be HTTP(S), without userinfo, query or fragment; invalid bases fail with a fixed diagnostic before auth, recording or fetch, preventing conventional URL-embedded credentials from entering the request log. Allowed bases/paths are not rewritten. The adapter id identifies the implementation; a custom configured endpoint need not be the default DeepSeek host. No credentials are retained as a new store.

Fallback notices are part of `WebSearchResult.content`, not merely an outer Tool result `content` or `meta`: Core may regenerate those outer fields from the canonical value. The notice names DeepSeek fallback, a bounded error reason and possible DeepSeek API charges, and explicitly says that the result is not from Copilot. Per-query notices remain available when the official consumer merges multiple queries. No search-time approval dialog is introduced.

`routeWebSearch` defaults to true; disabling it delegates through the original official service. `searchFallback` defaults to `deepseek` for the requested automatic fallback behavior; select `none` to prohibit cross-provider fallback spending. The existing master enable switch, provider allowlist, lazy account metadata and native capability proof remain in effect. These changes are not installed in the user's live profile yet.

## Verification to date

- `tests/search-routing.spec.ts`: 20 synthetic policy regressions covering route preservation, captured selections, fallback disclosures, cancellation, proof invalidation, unknown fallback provider refusal and simultaneous operations.
- `tests/routed-web.spec.ts`: 15 tests using actual official AgentRegistry, ToolRuntime, SystemPrompt, scoped official search consumers and WebRuntime instances. They cover native validation/caps, duplicate-query collapse, surrounding execution middleware, pre-execute denial, simultaneous Copilot/DeepSeek calls, unchanged fetch, provider Fiber disposal and fallback notices surviving canonical rendering/web-card metadata. Retained handles are rejected after facade disposal; in-flight Copilot work is aborted and drained; the official WebRuntime prototype remains unchanged.
- `tests/deepseek-search-fallback.spec.ts`: 37 keyless tests composing the real public DeepSeek provider, covering option snapshots, settings/env/credential precedence, request recording, cancellation, redirects, result parsing, safe backend/error metadata and rejection of unsafe API bases. Concurrent searches retain distinct endpoint/model disclosures from their own actual option snapshots.
- `tests/scripts/search-composition.test.mjs`: 22 pre-install checks, including real public parser use without initialization/normalization or secret output; custom/dynamic/nested/disabled/isolated web layouts are rejected before installation.
- `tests/routed-web-loader.spec.ts`: public patch composition checks plus an actual Loader boot of the built facade/delegate and official consumers. Since Vitest lacks Node's exposed internal module loader, this test resolves this plugin's public export names to file URLs before Loader import; the realm/config patches and built implementations are unchanged. Main authorization/chat activation is disabled in this isolated test and replaced only by a synthetic routing service. This is not live account acceptance.
- Existing inline-search tests use their pre-existing synthetic context; its fixture now models public `ctx.provide` registration and disposal required by the new router service. Nine additional main-router cases exercise non-Copilot delegation, owned managed primary search, real official fallback transport with synthetic responses, disabling fallback/routing, allowlist exclusion, user-facing disclosure guidance and credential invalidation before any fallback request.
- `verify-tagged-core.mjs` now selects the policy, real-consumer and fallback suites in addition to prior adapter tests. CI/release install the unchanged official search dependency closure; tooling regressions reject missing/reordered closure steps. This is test wiring, not proof that the remote matrix has run.

## Remaining before shipping

1. Complete the full verification gate and update deployment/agent evidence inventories, public export smoke and both READMEs.
2. Add end-to-end coverage of the main router's managed metadata, fallback credentials/options, cancellations during discovery/fallback, mixed multi-query provenance, and complete unload/reload behavior.
3. Run retained exact Core-baseline fixtures, not only the development artifact. Do not infer seven-pin runtime compatibility from type checks.
4. Align the new package version, release metadata and package/archive tests.
5. Run bounded live Copilot hosted-search and permitted-fallback acceptance separately. A successful chat request does not prove hosted search. No live profile installation, global search selection change or restart has occurred for this work.
