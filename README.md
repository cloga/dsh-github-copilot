# dsh-web-search-provider

A native web-search provider for the DeepSeek Harness web capability seam (`ctx.web`). One provider, two wire protocols:

- **OpenAI Responses API** — `POST {baseURL}/responses` with the server-side `web_search_2025_08_26` tool (the versioned spelling executes on gateway endpoints that drop a nameless `web_search`, e.g. OpenCode Zen/Go, and is documented by OpenAI and DeepSeek). The server executes the full browsing loop itself — `search`, `open_page`, and `find_in_page` actions — and the adapter understands all three, plus the `url_citation`/`web_search`/`search_result` annotation vocabulary for sources.
- **Anthropic-compatible Messages API** — `POST {baseURL}/messages` with the native `web_search_20250305` server tool, mapping `web_search_tool_result` blocks and citation excerpts exactly like the shipped `web-search-deepseek` plugin.

Unlike `include:web-search-deepseek` (DeepSeek-only, blind to whether its endpoint actually runs search), this plugin detects the provider the harness currently chats with, **probes** the chosen endpoint with one bounded request to verify native search really runs, and **auto-disables** when nothing answers — unless the user pins a protocol and endpoint in configuration.

## How selection works

| Configuration | Behavior |
|---|---|
| `protocol` set | Search always runs through that protocol. `baseURL`, `apiKeyEnv`, and `model` fall back to the current chat route when compatible, then to environment variables (`$DSH_WEB_SEARCH_RESPONSES_BASE_URL` / `$DSH_WEB_SEARCH_ANTHROPIC_BASE_URL`), then to the DeepSeek first-party defaults. |
| `protocol` unset | The current chat route is detected from the default-model selection (`agent-default-model`) plus the `llm-pi-ai` settings section. A route whose own protocol can search (`openai-responses`, `anthropic-messages`) is asked on that protocol. A Chat-Completions route cannot search on its wire, so the known search-capable sibling protocols of its host are probed instead: DeepSeek first-party (routes `deepseek` / `deepseek-official`, or the `api.deepseek.com` host) is probed on `openai-responses` then `anthropic-messages`; OpenAI is probed on `openai-responses`. Unknown gateways yield no siblings — configure `protocol` explicitly. |
| Nothing resolvable | The provider registers as unavailable, no tools are registered, and the boot log names the reason. |

Probing (default `probe: true`) forces the server-side tool through `tool_choice` and requires the structured evidence back (a `web_search_call` item, or a `web_search_tool_result` block). Several "Responses-compatible" gateways accept the `web_search` field and silently ignore it — exactly the failure a static protocol check cannot see. Each probe costs one real search on the provider, runs once per plan (in the background, bounded by `probeTimeoutMs`), and is skipped entirely with `probe: false`.

## Tools

The seam's `web_search` tool (`tool-web`, which the shipped composition enables) is served by this provider's `search()` on either protocol. In addition, when the plan serves the Responses API, the plugin registers the two browsing tools the seam cannot express:

- **`open_page`** — opens a specific URL through the server-side tool and returns the page's content summary.
- **`find_in_page`** — searches a loaded page for a pattern and returns the matching passages.

So a Responses-API deployment gets the full three-action browsing loop: `web_search` (search), `open_page`, `find_in_page`. Both tools are gated on the plan actually serving the Responses protocol: they are registered when the probe (or the pin) settles on `openai-responses` and withdrawn otherwise, so a tool that is gone is never called. `tools.openPage` / `tools.findInPage` disable each individually.

## Install

```sh
pnpm install
pnpm build        # tsc emits lib/types, tsdown bundles lib/index.js
pnpm test         # vitest unit suite
```

Reference the built plugin from a `cordis.yml` overlay:

```yaml
- insert:
    - id: web-search-provider
      name: '/absolute/path/to/dsh-web-search/lib/index.js'
      # all defaults; the current chat provider decides everything
```

or install the package and reference it by name. To replace the shipped DeepSeek search, also point the web seam at this provider:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: web-search-provider
```

## Config

All fields are optional; the schema defaults and the current chat route fill the rest.

| Key | Default | Meaning |
|---|---|---|
| `protocol` | unset | Explicit protocol pin: `openai-responses` or `anthropic-messages`. |
| `baseURL` | derived | Endpoint base; `/responses` or `/messages` is appended. Requires `protocol`. For `anthropic-messages`, a base without the `/v1` segment gets it appended (`https://api.anthropic.com` → `/v1/messages`). |
| `apiKey` | unset | Literal API key; prefer `apiKeyEnv` so no secret enters configuration. |
| `apiKeyEnv` | route ref → `DEEPSEEK_API_KEY` | Credential reference resolved per operation through `ctx.credentials`, then the launching environment. |
| `model` | route model → `deepseek-v4-flash` | Model name for the search request. |
| `apiVersion` | `2023-06-01` | `anthropic-version` header value. |
| `maxTokens` | `4096` | Upper bound on generated tokens for a Messages search. |
| `maxUses` | `5` | Maximum `web_search` server-tool uses per Messages request. |
| `maxOutputTokens` | `4096` | Upper bound on generated tokens for a Responses search. |
| `probe` | `true` | Verify the endpoint truly runs native search with one bounded request before serving. |
| `probeTimeoutMs` | `30000` | Bound on one probe request. |
| `timeoutMs` | `60000` | Cooperative timeout budget for `open_page` / `find_in_page`. |
| `tools.openPage` / `tools.findInPage` | `true` | Register the Responses-only browsing tools. |

```yaml
- id: web-search-provider
  name: 'dsh-web-search-provider'
  config:
    # Chat with anything, but always search through a gateway's Responses API.
    protocol: openai-responses
    baseURL: https://gateway.internal/v1
    apiKeyEnv: GATEWAY_API_KEY
    model: gpt-5.6
    probe: true
```

The section is a live user-settings namespace (`web-search-provider`): edits reach the next search without a restart, the plan re-probes only when the resolved candidates actually changed, and an in-flight search keeps the plan it started with.

## Publishing

The recommended path is [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC): the [publish workflow](.github/workflows/publish.yml) publishes from GitHub Actions with no npm token in the repository, and npm automatically attaches provenance attestations (public package, public repository). `repository.url` must exactly match the GitHub repository.

**First publish (token-based).** Trusted publishing is configured per package on npmjs.com, so the package must exist first. Log in and publish once with a token:

```sh
npm login --registry https://registry.npmjs.org
pnpm publish        # runs prepublishOnly: tests + build, then publishes
```

**Configure the trusted publisher.** On npmjs.com: Packages → `dsh-web-search-provider` → Settings → Trusted publishing → GitHub Actions, with:

| Field | Value |
|---|---|
| Organization or user | `hiyms` |
| Repository | `dsh-web-search-provider` |
| Workflow filename | `publish.yml` (the file in `.github/workflows/`) |
| Environment | leave empty (add a GitHub environment later for approval gates) |
| Allowed actions | `npm publish` |

npm does not validate the configuration when saved — the workflow filename and the repository URL are case-sensitive and must match exactly, or the first publish fails with `ENEEDAUTH`.

**Subsequent releases.** Bump the version in `package.json`, commit, tag, push:

```sh
pnpm version patch   # bumps, commits, and tags v0.1.1
git push --follow-tags
```

The workflow then runs tests and the build via `prepublishOnly`, publishes with OIDC, and provenance is generated automatically. Verify the attestation after a release:

```sh
npm attestations dsh-web-search-provider
```

Notes: provenance requires a **public** repository (it stops for private ones); use only GitHub-hosted runners (self-hosted runners are unsupported); the npm CLI side of OIDC needs npm ≥ 11.5.1 / Node ≥ 22.14, which the workflow's Node 24 satisfies. A local token-based `pnpm publish` remains available as a fallback but should not be needed.

## Failure semantics

- Provider failures surface as `WebError` `WEB_PROVIDER_ERROR`; caller cancellation as `WEB_ABORTED`; a missing credential as `WEB_PROVIDER_CREDENTIAL_MISSING` naming the reference.
- **Strict mode**: a 2xx reply without `web_search_call` (Responses) or `web_search_tool_result` (Messages) items is an error, never a prose-scraping fallback.
- Redirects are rejected before a `Location` target is contacted (credentials never follow).
- Responses are read with a 4 MiB ceiling; a non-2xx reply's error message is preserved when parseable.
- Each request is recorded in the initiating Agent's session log as the secret-free `web/search-native-llm-request` event before dispatch.

## Model Experience

A separate auxiliary model request (never part of the conversation context) receives the query as user text plus the native server tool definition. Responses mode returns the model's answer as `content` with cited URLs as `sources`; Messages mode returns structured result blocks joined with citation excerpts, with no trusted `content`. Input/output tokens accrue per search; `maxOutputTokens` / `maxTokens` cap generated output and `maxUses` caps server-tool uses.

## Known Limitations and Deferred Work

- **One search costs a full model turn** — latency plus generated tokens; neither protocol exposes a dedicated retrieval endpoint.
- **A probe costs one real search** (a full server-side search, roughly the price of a large input) each time the plan changes; disable with `probe: false` when the endpoint is known-good.
- **`open_page` / `find_in_page` run one model turn each** and are only as deterministic as the server-side model: `tool_choice` pins the tool, not the action, so the instruction carries the URL/pattern.
- **Over-returned sources still cost tokens** — with no result-count knob on either wire, `maxResults` is enforced only post-hoc by the seam.
- **Sibling derivation covers known hosts** — DeepSeek and OpenAI first-party endpoints; any other gateway needs an explicit `protocol` (and `baseURL`).
