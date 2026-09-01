# dsh-github-copilot

[![npm version](https://img.shields.io/npm/v/dsh-github-copilot)](https://www.npmjs.com/package/dsh-github-copilot)

[简体中文](./README.zh.md)

A first-class **main-agent** GitHub Copilot model integration for DeepSeek Harness (DSH). It composes OpenAI-compatible GitHub Copilot gateway routes and model metadata for DSH Core, and preserves provider-hosted search in the model's own turn.

## Scope and ownership

This package provides:

- failure-safe `/v1/models` discovery with GitHub Copilot capability metadata;
- installer-ready OpenAI Responses and Chat Completions route composition;
- reasoning effort, context/output limit, and text/image capability mapping;
- provider-hosted search on Responses, including the traditional `ctx.web` bridge;
- DSH replay item normalization and SSE-to-`StreamChunk` compatibility;
- a startup API compatibility guard and a machine-readable deployment baseline.

DSH Core remains authoritative for model selection, plan/code/tool modes, tool presentation, sandbox policy, credentials, official image/vision attachment routing, and Desktop Core selection. Image-bearing calls bypass the hosted-search wire unchanged and use Core's official vision route. This package intentionally provides **no ACP or subagent integration**.

## Compatibility

- Node.js: `>=22.0.0`
- DSH release baseline: `0.1.1-rc.2`
- DSH development baseline: `0.1.2-alpha.3`
- DSH peer range: `^0.1.1-rc.2 || ^0.1.2-alpha.2`

`assertDshCompatibility()` runs before plugin effects are registered. Missing required DSH APIs fail startup with a named error. `pnpm verify:baseline` also checks the peer range, required source/test evidence, one-entry bundle patch, package exports, and the explicit main-agent-only boundary.

## Install

```sh
dsh plugin add dsh-github-copilot
```

The bundle patch installs exactly one entry:

```yaml
- insert:
    - id: github-copilot
      name: dsh-github-copilot
```

## Gateway model routes

The operations installer owns gateway discovery and settings persistence. It should:

1. Resolve the gateway base URL and the `COPILOT_GITHUB_TOKEN` credential reference.
2. Call `synchronizeGitHubCopilotModelCatalog()` with a pinned static fallback.
3. Call `composeGitHubCopilotProviderRoutes()`.
4. Merge the returned `providers` object into `llm-pi-ai.providers`.
5. Use the existing DSH default-model service to select one returned provider/model pair.

```ts
import {
  composeGitHubCopilotProviderRoutes,
  synchronizeGitHubCopilotModelCatalog,
} from 'dsh-github-copilot'

const models = await synchronizeGitHubCopilotModelCatalog({
  baseURL: gatewayBaseURL,
  headers: { authorization: `Bearer ${gatewayToken}` },
  fallback: pinnedModels,
})

const { providers } = composeGitHubCopilotProviderRoutes({
  baseURL: gatewayBaseURL,
  apiKeyEnv: 'COPILOT_GITHUB_TOKEN',
  models,
})

// Merge into the existing settings document; do not replace unrelated routes.
settings['llm-pi-ai'].providers = {
  ...settings['llm-pi-ai'].providers,
  ...providers,
}
```

The helper writes these route fields:

| Route | `api` | Other fields |
|---|---|---|
| `github-copilot` | `openai-responses` | `baseURL`, `apiKeyEnv`, `models` |
| `github-copilot-chat` | `openai-completions` | `baseURL`, `apiKeyEnv`, `models` |

A model that advertises both endpoints appears on both routes. Catalog entries preserve `id`, `name`, preferred `api`, all `apis`, `input`, `contextWindow`, `maxTokens`, `reasoning`, and `reasoningEfforts`. Discovery failures return the exact fallback object. No helper mutates DSH settings.

## Hosted search configuration

The live settings namespace is `github-copilot`:

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master hosted-search switch. |
| `providers` | `[]` | Allowed `llm-pi-ai` route IDs; empty follows the active main-agent route. |
| `baseURL` | active route | Search endpoint override. |
| `model` | active model | Probe and hosted-search model override. |
| `apiKeyEnv` | active route | DSH credential reference. |
| `includeSources` | `true` | Request hosted-search source metadata. |
| `stripServerTools` | `true` | Remove local function variants of provider-hosted tools. |
| `idleTimeoutMs` | `300000` | Inline stream idle timeout. |
| `probe` | `true` | Verify native hosted search before serving. |
| `probeTimeoutMs` | `30000` | Capability probe timeout. |

The plugin also registers search provider `github-copilot-hosted`; set the existing DSH web service's `searchProvider` to that ID when desired. It does not register a fetch provider.

## Migration from `dsh-web-search-provider`

1. Remove the old `dsh-web-search-provider` bundle/package entry.
2. Install `dsh-github-copilot` and change the bundle ID from `web-search-provider` to `github-copilot`.
3. Move settings namespace `web-search-provider` to `github-copilot` without changing field values.
4. Change web `searchProvider` from `copilot-hosted` to `github-copilot-hosted`.
5. Add the two `llm-pi-ai.providers` routes described above and select a Copilot model through Core.
6. Replace the old baseline/package/tarball pins with `cloga.dsh-github-copilot`, `dsh-github-copilot`, and the new archive metadata.
7. Remove any ACP/subagent-specific composition; it is outside this package's contract.

The deprecated `COPILOT_HOSTED_SEARCH_PROVIDER_ID` export remains as a source migration aid; new code should use `GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID`.

## Build and verify

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm verify:baseline
pnpm build
pnpm pack --pack-destination artifacts
```

Every archive exports `./deployment-baseline.json`. Consumers must pin the source commit, tarball filename, and SHA-256, and reject a baseline mismatch.