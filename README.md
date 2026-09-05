# dsh-github-copilot

[![CI](https://github.com/cloga/dsh-github-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/cloga/dsh-github-copilot/actions/workflows/ci.yml)
[![Release](https://github.com/cloga/dsh-github-copilot/actions/workflows/release.yml/badge.svg)](https://github.com/cloga/dsh-github-copilot/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/cloga/dsh-github-copilot)](https://github.com/cloga/dsh-github-copilot/releases/latest)
[![License](https://img.shields.io/github/license/cloga/dsh-github-copilot)](./LICENSE)

**English** | [简体中文](./README.zh.md)

A focused DSH companion for GitHub Copilot sign-in, account-aware model profiles, Copilot-specific tool compatibility, and provider-hosted search. It reuses DSH's built-in `@deepseek-ai/dsh-llm-pi-ai`; it is not a second Copilot model adapter or catalog.

## Tested baselines

| DSH surface | Tested source | Models UI |
|---|---|---|
| Controlled Desktop `0.1.1-rc.2` baseline | Controlled Core commit [`a772dbb`](https://github.com/cloga/deepseek-harness/commit/a772dbbde82780bff2b9394427e9f0a24cafa1d5) on `cloga-pi-ai-model-api` | Dedicated **Settings → GitHub Copilot** section |
| DSH `0.1.2-rc.1` | Tag commit [`a66e470`](https://github.com/deepseek-ai/deepseek-harness/commit/a66e4702047846cdaa10c66c9d3df3951f5ea70d) | **Settings → Models** provider card |
| DSH `0.1.3-alpha.1` | Tag commit [`d347e70`](https://github.com/deepseek-ai/deepseek-harness/commit/d347e703908d0406b7a7ef80e3a0e594d86b2215) | **Settings → Models** provider card |

The stock rc.2 tag does not resolve per-model `api` entries and is not the tested mixed-protocol baseline. Package peer ranges admit only the three exact DSH releases above. Newer DSH or pi-ai versions require a fresh compatibility review before the range changes.

## Install and sign in

Install the current release into the profile you use (replace `web` when targeting another profile):

```sh
dsh plugin --profile web add https://github.com/cloga/dsh-github-copilot/releases/download/v0.3.1-alpha.2/dsh-github-copilot-0.3.1-alpha.2.tgz
```

Then open the Models UI listed above, find **GitHub Copilot**, select **Sign in**, and complete the GitHub device-code flow. Plugin installation changes the selected profile; activation follows that profile's normal reload/restart policy.

### User authorization flow

1. Open **Settings → Models** and find the `github-copilot` provider card.
2. Select **Sign in with GitHub**. The card changes to **Waiting for GitHub authorization…**, shows a prominent standalone one-time code, an **Open GitHub verification page** link, and a **Copy code** button.
3. Copy the code with one click, open the link, sign in to the GitHub account that owns the Copilot entitlement, paste the code, and approve the request. The card confirms when copying succeeds and provides a manual-copy fallback if clipboard access fails. Never paste a GitHub token into DSH.
4. Return to DSH. The card polls automatically; success is shown as **Signed in to GitHub Copilot.** with a **Sign out** button. The one-time URL and code disappear after success.
5. Select a model under the `github-copilot` provider. If no model appears, restart the profile once and see [Migration and troubleshooting](#migration-and-troubleshooting).

The entry path starts from **Add provider**, continues by selecting **github-copilot**, and then opens the GitHub Copilot authorization card:

![Animated GitHub Copilot provider setup flow](./docs/images/github-copilot-auth-flow.gif)

The final in-flight card makes the code prominent and provides one-click copy. The screenshot uses the synthetic documentation code `ABCD-EFGH`; no real authorization request or credential was captured.

![Prominent GitHub device code with one-click copy](./docs/images/copilot-device-code-copy.png)

The device code is temporary and should be visible only while authorization is in progress. The close-up below records the affected pre-fix behavior, where a successful status was incorrectly displayed beside the stale code. Current builds clear that instruction after authorization settles.

![Close-up of the stale authorization notice](./docs/images/copilot-auth-card-stale-notice.png)

### Agent and automation flow

Agents should treat the browser authorization as a human handoff, not as a token-acquisition task:

1. Install the pinned release into the requested profile and restart/reload that profile when required.
2. Direct the user to **Settings → Models → GitHub Copilot → Sign in with GitHub**.
3. Tell the user to open the displayed verification URL and enter the displayed one-time code. Do not ask for, read, copy, log, or persist the user's GitHub token.
4. Wait for the user to complete the browser step. Do not repeatedly start new authorization attempts while one is in flight.
5. Confirm that the card says **Signed in to GitHub Copilot.**, that the device-code notice is gone, and that Copilot models are available.
6. Use **Sign out** only when the user explicitly asks to disconnect the account. It deletes the Copilot credential record but preserves route settings.

GitHub Releases are the authoritative distribution channel. This repository intentionally does not publish to npm. Deployment automation should pin the versioned tarball and verify `SHA256SUMS` from the same Release.

No `copilot2api` process, external gateway, placeholder API key, pasted GitHub token, or separate `dsh-web-search-provider` installation is required.

## What this package owns

- A conditional authorization-service fallback for profiles such as rc.2 that omit Core's service.
- The Models provider-card UI, Client-safe Remote descriptors, and Host authorization controller.
- Strict normalization of pi-ai's provider-owned Copilot OAuth grant.
- Account-aware reconciliation of the Copilot route's `models` and `compat.supportsStrictMode` leaves.
- A temporary, account-gated GPT-6 Astra compatibility overlay that retires automatically when the installed pi-ai catalog owns the model.
- Direct provider-hosted search through inline agent-loop interception and a Responses-only `ctx.web` provider.

DSH Core continues to own model selection, sandboxing, tools, attachments, and other providers. `@deepseek-ai/dsh-llm-pi-ai` owns the Copilot adapter, catalog, OAuth method and grant format, token exchange, refresh, and normal model transport. Credentials remain Host-only.

## Authorization and route behavior

`llm-pi-ai` registers the OAuth method; the authorization service orchestrates the interaction; this package contributes the UI/Remote controller and route reconciliation. Core supplies authorization on rc.1. On rc.2 profiles that omit it, this package mounts its runtime dependency and reuses any provider already present.

After sign-in, during Host startup, and after this package refreshes the OAuth credential, the package intersects the account's `availableModelIds` with the installed pi-ai catalog and materializes each known model as `{ id, api }`. Account model IDs missing from the installed catalog are never assigned a guessed protocol, except for the exact `gpt-6-astra` compatibility overlay whose metadata is derived from upstream pi and models.dev. Because released llm-pi-ai builds require a route protocol for a model absent from pi-ai, the overlay temporarily selects `openai-responses` at route level and exposes only account models that speak Responses; Claude, Gemini, and other protocol models are reported as temporarily hidden rather than misrouted. The route protocol and filtering retire automatically once the installed catalog owns GPT-6 or the account no longer exposes it. Other unknown IDs produce a Models-card catalog warning. A missing profile is created without unrelated connection references. For an existing profile, reconciliation intentionally changes only:

- `providers.github-copilot.api` while the temporary GPT-6 Responses route mode is active
- `providers.github-copilot.models`
- `providers.github-copilot.compat.supportsStrictMode`
- `providers.github-copilot.headers` when the temporary GPT-6 overlay requires Copilot client headers

Every other Copilot field and unrelated provider is preserved, including legacy `baseURL` or `apiKeyEnv` values. Before taking temporary ownership, the plugin stores a hidden JSON backup of the route's original `api`, `models`, and `headers` leaves in its own settings namespace. Retirement restores that backup—even when the refreshed account has no usable models—then removes the marker; it never deletes unrelated route fields. Remove legacy connection fields explicitly during migration. Sign-out itself still deletes only the `llm-pi-ai/github-copilot` credential record and keeps route settings.

Before a grant is persisted or reused, the Host normalizer rebuilds only pi-ai's documented `type`, `refresh`, `access`, finite `expires`, optional `enterpriseUrl`, and optional deduplicated `availableModelIds` fields into a fresh plain JSON object.

## Hosted search

- **Inline agent-loop path:** supports native-search candidates using OpenAI Responses or Anthropic Messages.
- **`github-copilot-hosted` through `ctx.web.search()`:** supports OpenAI Responses candidates only.
- **Chat Completions models:** remain usable through normal `llm-pi-ai` transport but do not advertise hosted search.

Installing this package registers `github-copilot-hosted` but deliberately does not replace the profile-wide `web.searchProvider`. This keeps mixed-provider profiles unchanged. A Copilot-focused profile can opt in by adding the following row to `$DSH_HOME/profiles/<profile>/cordis.patch.yml` (merge it into the existing top-level patch list):

```yaml
# Optional: route the Core web_search Tool through GitHub Copilot.
- id: web
  config:
    searchProvider: github-copilot-hosted
    fetchProvider: http
```

A patch row replaces the target row's complete `config`, so keep `fetchProvider: http` for the default HTTP fetcher (or retain your explicitly configured fetch provider). If a `web` override already exists, update that row rather than replacing the whole patch file; keep unrelated configuration. Restart that profile after editing. This is a global profile choice, not model-aware routing: on a non-Copilot or non-Responses route, `web_search` reports the configured Copilot provider unavailable and does not fall back to DeepSeek. To undo it, remove only the row added for this opt-in or restore your previous `web` configuration.

An explicit `web.searchProvider` takes precedence over `DSH_WEB_SEARCH_PROVIDER`. Setting that environment variable alone will not override a bundle that already selects `deepseek-official`. A `DEEPSEEK_API_KEY` search error therefore means the direct search Tool still selected DeepSeek; Copilot sign-in does not configure DeepSeek credentials. The Copilot search path uses its own OAuth grant and does not require that key.

Requests go directly to the credential-resolved HTTPS Copilot endpoint after strict host validation: GitHub-hosted `api.*.githubcopilot.com`, or `copilot-api.<signed-in-enterprise-domain>` for an accepted GitHub Enterprise credential. No external gateway receives the credential.

By default (`probe: true`), search fails closed unless the selected route is `github-copilot`, the account exposes the model, the installed protocol supports native search, and a bounded capability probe succeeds. Setting `probe: false` bypasses only capability proof and trusts the selected native protocol; route, account, protocol, endpoint, and authentication checks remain active. Authentication, HTTP, malformed-body, abort, and network probe failures do not fall back to an external search path. Requests containing any Core file block—including files nested in tool-result content—also fail closed to `next()`, preserving Core's file projection instead of letting the hosted-search serializer drop that context.

## Copilot tool compatibility

To prevent observed invalid Copilot tool payloads, the package sets the managed route's `compat.supportsStrictMode` leaf to `false` and applies two schema-only fixes when the selected provider is exactly `github-copilot`: it removes top-level `sandbox_permissions` and `justification` properties, and rewrites Core's multi-action `update_goal` parameters as a discriminated `oneOf`. Each Goal action then advertises only its legal fields: `complete`, `pause`, and `resume` cannot carry edit or blocker fields; `blocked` requires `blocked_reason`; and `edit` alone exposes replacement fields. Execution still uses Core's original Goal tool and service. Non-Copilot prompt assemblies are unchanged.

Copilot sessions that need wider file or command access must select sufficient standing permissions before the call. Installation agents must also follow these payload rules:

- Omit `sandbox_permissions` and `justification` on initial `pwsh` calls.
- Never emit them when approval prompts are disabled or the current mode is already `danger-full-access`.
- Use them only for the single exact-command retry allowed after a real sandbox denial when approval is available and the requested mode is wider.
- Omit the keys entirely rather than sending null, empty, or current-mode values.

The plugin does not rewrite `$DSH_HOME/AGENTS.md`. Installers may merge these rules into user instructions only with explicit user consent.

## Settings

The `github-copilot` settings section controls hosted search only:

| Key | Default | Scope and meaning |
|---|---:|---|
| `enabled` | `true` | Enable both hosted-search surfaces. |
| `providers` | `[]` | Optional route allowlist for both surfaces; empty follows the selected route. |
| `includeSources` | `true` | Request provider citations on the inline path. The `ctx.web` bridge always requests and returns sources. |
| `stripServerTools` | `true` | On the inline path, remove local function variants of provider-hosted search tools. |
| `idleTimeoutMs` | `300000` | Inline stream idle timeout and `ctx.web` request deadline, in milliseconds. |
| `probe` | `true` | Require capability proof on both surfaces; `false` explicitly trusts the native protocol. |
| `probeTimeoutMs` | `30000` | Whole capability-probe deadline, in milliseconds. |

There are no token, API-key, model-catalog, or endpoint settings in this package.

## Migration and troubleshooting

Remove old gateway routes, `COPILOT_GITHUB_TOKEN`-style references, `copilot2api`, and `dsh-web-search-provider` before relying on the managed route.

- **No sign-in control:** confirm the package is installed in the active profile and use the baseline-specific Models UI above.
- **Signed in but a new model is missing:** check the Models card for a catalog warning. GPT-6 Astra is temporarily recognized when the account advertises the exact `gpt-6-astra` ID. While that compatibility mode is active, non-Responses account models are listed as temporarily hidden; remove GPT-6 from the account policy or install native pi-ai support to restore the mixed route. Other unknown IDs are withheld until verified metadata is available.
- **Hosted search unavailable:** select the `github-copilot` route, choose an account-available Responses or Anthropic model, and inspect the named probe error. The explicit `ctx.web` provider is Responses-only.
- **Legacy endpoint/key still present:** reconciliation preserves unowned fields by design; remove legacy connection fields manually.

## Package entries and source map

Public exports are `.`, `./client`, `./remote`, `./deployment-baseline.json`, and `./package.json`.

- `src/index.ts`: authorization bootstrap, dependency-gated Host composition, settings, inline interception, and `ctx.web` registration.
- `src/authorization-controller.ts`: Host authorization and path-level route reconciliation.
- `src/copilot-grant.ts`, `src/copilot-auth.ts`: grant normalization and Host credential lifecycle.
- `src/client.ts`, `src/remote.ts`: Models UI and Client-safe Remote contract.
- `src/current-provider.ts`, `src/temporary-models.ts`, `src/plan.ts`, `src/probe.ts`: selected-route projection, the self-retiring GPT-6 overlay, candidate planning, and capability proof.
- `src/wire.ts`, `src/wire-anthropic.ts`, `src/traditional-search.ts`: hosted-search transports.
- `deployment-baseline.json`: declared machine-readable compatibility/capability evidence inventory; `scripts/verify-deployment-baseline.mjs` checks its source and test markers for drift.
- `lib/`: generated release output; never edit it directly.

## Build and verify

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
```

`pnpm verify` runs typechecking, deployment-baseline checks, build, all tests, and package-export smoke checks. CI additionally verifies the exact controlled rc.2 and rc.1 upstream sources on Windows and Linux.

## Release and checksum verification

`package.json` is private to prevent registry publication. A release tag must equal `v${package.json.version}`. Versions use standard SemVer prerelease labels (`alpha`, `beta`, or `rc`); the historical `cloga` suffix identified downstream fork builds and is no longer used for new versions. The Release workflow performs the frozen install and complete verification gate, packs the tarball, writes `SHA256SUMS`, marks prerelease versions accordingly, and creates the GitHub Release only after every preceding step succeeds.

```sh
curl -LO https://github.com/cloga/dsh-github-copilot/releases/download/v0.3.1-alpha.2/dsh-github-copilot-0.3.1-alpha.2.tgz
curl -LO https://github.com/cloga/dsh-github-copilot/releases/download/v0.3.1-alpha.2/SHA256SUMS
sha256sum --check SHA256SUMS
```

PowerShell can verify the same two downloaded files with:

```powershell
$expected = (Get-Content .\SHA256SUMS).Split()[0]
$actual = (Get-FileHash .\dsh-github-copilot-0.3.1-alpha.2.tgz -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -cne $expected) { throw 'Release checksum mismatch' }
```

The checksum detects download corruption or asset drift; repository controls and the protected Release workflow establish publisher provenance. Never move or reuse a release tag. Increment the package and deployment-baseline versions together for every release. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the change workflow and [SECURITY.md](./SECURITY.md) for private vulnerability reporting.
