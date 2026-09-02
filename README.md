# dsh-github-copilot

[![npm version](https://img.shields.io/npm/v/dsh-github-copilot)](https://www.npmjs.com/package/dsh-github-copilot)

[简体中文](./README.zh.md)

One plugin for GitHub Copilot models and provider-hosted web search in DSH Desktop `0.1.1-rc.2` and DeepSeek Harness (DSH) `0.1.2-alpha.3`.

## Install and sign in

```sh
dsh plugin add dsh-github-copilot
```

Then open **Settings → Models**, find **GitHub Copilot**, and select **Sign in**. Complete the GitHub device-code flow shown in the provider card. The plugin uses DSH's built-in `llm-pi-ai` provider and writes a reference-free `llm-pi-ai.providers.github-copilot` profile without replacing other settings.

On Desktop `0.1.1-rc.2`, open the dedicated **Settings → GitHub Copilot** page because that release predates the Models provider-card extension slot. On `0.1.2-alpha.3`, the same controls render directly in the GitHub Copilot provider card.

No `copilot2api` process, gateway URL, placeholder API key, pasted GitHub token, or separate `dsh-web-search-provider` installation is required.

The package installs `@deepseek-ai/dsh-authorization` as a runtime dependency. Its Cordis bootstrap mounts that service for the rc.2 web/headless profiles, which provide credentials and `llm-pi-ai` but not authorization. When alpha.3 Core already provides authorization, the bootstrap reuses that service and does not register a duplicate. The integration body remains dependency-gated until authorization and every other required DSH service are active.

## Product behavior

- DSH's dormant `llm-pi-ai` mount owns the Copilot model adapter, catalog, OAuth flow, credential record, and token refresh.
- DSH alpha.3 Core owns the authorization service; this package supplies the same service only for profiles such as rc.2 that omit it.
- This package contributes the Models provider-card UI and its Host-only authorization Remote.
- Successful sign-in intersects the account's `availableModelIds` with the installed pi-ai catalog when creating a new route profile.
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

Credential payloads never cross the Client Remote. The hosted-search adapter uses pi-ai's public `createModels()` and `Models.getAuth()` path, so refresh remains serialized inside DSH's credential-record mutation.

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
- `src/remote.ts`: Client-safe Typert descriptors.
- `src/current-provider.ts`, `src/plan.ts`: selected-route projection and fail-closed search planning.
- `src/probe.ts`, `src/wire*.ts`, `src/traditional-search.ts`: hosted-search transports.
- `lib/index.js`, `lib/client.js`, `lib/remote.js`: generated package entries; never edit them directly.

Public package entries are `.`, `./client`, `./remote`, and `./deployment-baseline.json`.

The package peer contract supports DSH `0.1.1-rc.2` and `0.1.2-alpha.3`; authorization is additionally a real runtime dependency so one-package rc.2 installation is complete. The published rc.2 packages are the local compiler baseline; CI checks the exact rc.2 and alpha.3 source commits and their required public seams separately.

## Build and verify

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm verify:baseline
pnpm build
pnpm verify:package
pnpm pack --pack-destination artifacts
```

`pnpm verify` runs the complete local test, typecheck, baseline, build, and package-smoke path. See [AGENTS.md](./AGENTS.md) for repository invariants and change workflow.
