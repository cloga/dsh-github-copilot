# dsh-github-copilot

[![npm version](https://img.shields.io/npm/v/dsh-github-copilot)](https://www.npmjs.com/package/dsh-github-copilot)

[简体中文](./README.zh.md)

One plugin for GitHub Copilot models and provider-hosted web search in DSH Desktop `0.1.1-rc.2` and DeepSeek Harness (DSH) `0.1.2-alpha.5`.

## Install and sign in

```sh
dsh plugin add dsh-github-copilot
```

Then open **Settings → Models**, find **GitHub Copilot**, and select **Sign in**. Complete the GitHub device-code flow shown in the provider card. The plugin uses DSH's built-in `llm-pi-ai` provider and writes a reference-free `llm-pi-ai.providers.github-copilot` profile without replacing other settings.

On Desktop `0.1.1-rc.2`, open the dedicated **Settings → GitHub Copilot** page because that release predates the Models provider-card extension slot. On `0.1.2-alpha.5`, the same controls render directly in the GitHub Copilot provider card.

No `copilot2api` process, gateway URL, placeholder API key, pasted GitHub token, or separate `dsh-web-search-provider` installation is required.

The package installs `@deepseek-ai/dsh-authorization` as a runtime dependency. Its Cordis bootstrap mounts that service for the rc.2 web/headless profiles, which provide credentials and `llm-pi-ai` but not authorization. When alpha.5 Core already provides authorization, the bootstrap reuses that service and does not register a duplicate. The integration body remains dependency-gated until authorization and every other required DSH service are active.

### Installation-agent DSH practice

The plugin writes `compat.supportsStrictMode: false` into its managed Copilot route and removes `sandbox_permissions` plus `justification` from tool schemas assembled for the `github-copilot` provider. Copilot models repeatedly emit those fields even when ordinary JSON Schema marks them optional, so hiding them is the only verified way to preserve initial calls. Other providers retain DSH's one-shot escalation path. Copilot sessions that need wider access must select a sufficient standing permission before the call. Installation agents must also follow this payload practice:

- Initial `pwsh` calls omit `sandbox_permissions` and `justification` entirely.
- When approval prompts are disabled, never include either field.
- When the current sandbox mode is `danger-full-access`, never request escalation.
- Use both fields only once, when retrying the exact same command after a real sandbox denial, approval is available, and the target mode is strictly wider than the current mode.
- Omit the keys rather than sending `null`, empty strings, or the current sandbox mode.

To persist these rules user-wide, add them to `$DSH_HOME/AGENTS.md` (default `~/.dsh/AGENTS.md`). Installers must merge them with existing user instructions rather than overwrite the file, and must never silently mutate it without explicit user consent. This plugin does not and should not rewrite user-global agent instructions.

## Product behavior

- DSH's dormant `llm-pi-ai` mount owns the Copilot model adapter, catalog, OAuth flow, credential record, and token refresh.
- DSH alpha.5 Core owns the authorization service; this package supplies the same service only for profiles such as rc.2 that omit it.
- This package contributes the Models provider-card UI and its Host-only authorization Remote.
- All four authorization Remote results use one strict Zod v4 codec, so rc.2 validates status/start/cancel/sign-out views while alpha.5 keeps the same wire contract.
- Successful sign-in and Host startup intersect the account's `availableModelIds` with the installed pi-ai catalog when creating or repairing the route profile. Empty, incomplete, or stale profiles self-heal idempotently, including after the Models UI saves an empty provider entry. Each model entry carries its catalog `api`, so one route preserves mixed protocols without route-level `api`, `baseURL`, or `apiKeyEnv`. The managed route sets `compat.supportsStrictMode: false`, and Copilot-scoped prompt assembly removes the two escalation arguments entirely because optional schema semantics alone are insufficient for these models.
- Before a Copilot OAuth grant is persisted or reused, the Host adapter rebuilds pi-ai's documented fields into a fresh plain JSON object. Cross-module and null-prototype credentials are accepted when their owned fields are valid; unrelated extension members are discarded, model IDs are deduplicated in order, and malformed owned fields fail without logging their values.
- Sign-out deletes only `llm-pi-ai/github-copilot`. It intentionally keeps the route profile and all unrelated settings.
- Hosted search calls `api.individual.githubcopilot.com` directly with the refreshed credential from that same record.
- The inline path adds the provider-native web-search tool to eligible agent-loop calls. The `github-copilot-hosted` provider exposes the same capability through `ctx.web`.
- Search is fail-closed: the selected route must be `github-copilot`, the selected account must expose the model, its catalog protocol must support native search, and the capability probe must pass. Responses probes retry only a valid 2xx reply that omitted `web_search_call`, for at most two rounds over both supported spellings (four requests total); auth, HTTP, malformed-body, abort, and network failures stop immediately, and every attempt shares the configured whole-probe timeout.

Models that only use Chat Completions are still usable through DSH's normal `llm-pi-ai` path, but they do not advertise hosted search. Responses and Anthropic Messages candidates are probed before use.

## Ownership boundary

| Surface | Owner |
|---|---|
| Copilot chat/model transport and catalog | DSH `@deepseek-ai/dsh-llm-pi-ai` + pi-ai |
| Authorization service lifecycle | DSH Core when present; this package's rc.2 bootstrap otherwise |
| OAuth/device flow registration | DSH authorization seam + `llm-pi-ai` |
| Credential storage and refresh | DSH credentials record `llm-pi-ai/github-copilot` + pi-ai |
| Models sign-in/status/sign-out UI | This package's `./client` entry |
| Browser-to-Host authorization calls | This package's `./remote` and Host controller |
| Reference-free route mutation | This package, through DSH settings path mutation |
| Hosted search probe, inline wire, and `ctx.web` bridge | This package, Host-only |
| Model selection, sandboxing, tools, attachments, and other providers | DSH Core |

Credential payloads never cross the Client Remote. The hosted-search adapter uses pi-ai's public `createModels()` and `Models.getAuth()` path, so refresh remains serialized inside DSH's credential-record mutation. Its strict Copilot normalizer persists only `type`, `refresh`, `access`, finite `expires`, optional `enterpriseUrl`, and optional `availableModelIds`.

## Settings

The `github-copilot` settings section contains only hosted-search behavior:

| Key | Default | Meaning |
|---|---:|---|
| `enabled` | `true` | Enable the hosted-search integration. |
| `providers` | `[]` | Optional route allowlist; empty follows the selected route. |
| `includeSources` | `true` | Request and return provider citations. |
| `stripServerTools` | `true` | Remove local function variants of provider-hosted search tools. |
| `idleTimeoutMs` | `300000` | Inline stream idle timeout. |
| `probe` | `true` | Require native hosted-search evidence before serving. |
| `probeTimeoutMs` | `30000` | Capability probe timeout. |

There are no token, API-key, model-catalog, or endpoint settings in this package.

## Migration

Remove old Copilot gateway routes, `COPILOT_GITHUB_TOKEN`-style credential references, `copilot2api`, and `dsh-web-search-provider`. Install this package, sign in from **Settings → Models**, select an account-available Copilot model, and select `github-copilot-hosted` only when an explicit `ctx.web` search provider is needed.

## Source and package entries

- `src/index.ts`: conditional authorization bootstrap, dependency-gated Host composition, and hosted-search registration.
- `src/authorization-controller.ts`: Host authorization/settings bridge.
- `src/copilot-auth.ts`: Host-only DSH credential-record adapter for pi-ai refresh.
- `src/client.ts`: Models provider-card UI.
- `src/remote.ts`: Client-safe Typert descriptors and the shared strict authorization-view result codec.
- `src/current-provider.ts`, `src/plan.ts`: selected-route projection and fail-closed search planning.
- `src/probe.ts`, `src/wire*.ts`, `src/traditional-search.ts`: hosted-search transports.
- `lib/index.js`, `lib/remote.js`: generated ESM Host/Remote package entries.
- `lib/client.js`: generated DSH client closure bundle. It registers `dsh-github-copilot` through `window.__ModuleLoader__.load`, resolves loader-table externals through the injected `require`, and returns `apply`/`inject`; never edit it directly.

Public package entries are `.`, `./client`, `./remote`, and `./deployment-baseline.json`.

The package peer contract supports DSH `0.1.1-rc.2` and `0.1.2-alpha.5`; authorization and Zod v4 are real runtime dependencies so one-package rc.2 installation and strict Remote result validation are complete. Mixed-protocol rc.2 routes require the controlled Core commit `a772dbbde82780bff2b9394427e9f0a24cafa1d5` on `cloga-pi-ai-model-api`, based on the rc.2 tag; the stock tag does not resolve model-entry `api`. CI checks that exact controlled rc.2 commit and the alpha.5 source commit separately, including a real controlled-Core config acceptance test and alpha.5's Fetch-validated provider headers.

## Build and verify

The client build follows DSH's standard `packages/client/tsdown.client.ts` contract: tsdown emits CJS inside a loader factory instead of publishing plain browser ESM.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm verify:baseline
pnpm build
pnpm test
pnpm verify:package
pnpm pack --pack-destination artifacts
```

`pnpm verify` runs the complete local test, typecheck, baseline, build, and package-smoke path. See [AGENTS.md](./AGENTS.md) for repository invariants and change workflow.
