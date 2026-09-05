# Agent guide

This file is the authoritative entry point for humans and coding agents. Read it before changing code.

## Product and architecture

`dsh-github-copilot` is a companion to DSH `0.1.3-alpha.1`, DSH `0.1.2-rc.1`, and the controlled DSH Desktop `0.1.1-rc.2` Core baseline. It does not own a general Copilot chat adapter. DSH's built-in `llm-pi-ai` mount owns the GitHub Copilot provider, catalog, OAuth method and grant format, token exchange, refresh, and normal model transport.

This repository owns seven narrow surfaces:

1. A conditional authorization-service bootstrap plus Host controller that joins DSH authorization, credentials, and settings.
2. A Client Models provider-card contribution and Client-safe Remote descriptors.
3. Strict JSON normalization of pi-ai's provider-owned Copilot OAuth grant.
4. Reference-free creation of a missing `llm-pi-ai.providers.github-copilot` profile plus leaf-only reconciliation of existing profiles.
5. Direct provider-hosted search using the same Host-side credential lifecycle.
6. Provider-scoped tool-schema compatibility for Copilot payload behaviors; Core remains the tool and execution owner.
7. A narrow, self-retiring compatibility overlay for exact account-advertised Copilot models that upstream pi-ai already specifies but has not yet published in its Copilot catalog.

## File map

- `src/index.ts`: authorization bootstrap, dependency-gated Host entry, settings registration, listener, and `ctx.web` provider composition.
- `src/authorization-controller.ts`: sign-in/status/sign-out and route mutation.
- `src/copilot-grant.ts`, `src/copilot-auth.ts`: strict grant normalization and narrow pi-ai `CredentialStore` adapter over `llm-pi-ai/github-copilot`.
- `src/client.ts`: `settings.models.provider-card` UI keyed by `llm-pi-ai`.
- `src/remote.ts`: Typert Remote contribution. Never add credential payloads here.
- `src/current-provider.ts`: selected DSH route plus installed pi-ai catalog facts.
- `src/temporary-models.ts`: exact, account-gated compatibility metadata that self-retires when the installed pi-ai catalog owns the same model ID.
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

- Do not add a second general Copilot LLM adapter or model catalog.
- Temporary model overlays must name exact IDs, remain gated by the OAuth grant's `availableModelIds`, defer to an installed pi-ai entry with the same ID, and be removed after upstream publication.
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

- Models UI: rc.1 and alpha.1 use `settings.models.provider-card`, keyed by settings namespace `llm-pi-ai`; rc.2 falls back to a dedicated `settings.section`.
- Authorization flow key: `llm-pi-ai/github-copilot`.
- Authorization service: rc.1 Core provides it; the rc.2 web/headless profiles rely on this package's runtime dependency and conditional bootstrap.
- Credentials: use record description/read/modify/delete APIs on the Host. Never read records in the browser.
- Copilot grant schema: `type: oauth`, non-empty `refresh`/`access`, finite `expires`, optional non-empty `enterpriseUrl`, and optional deduplicated non-empty-string `availableModelIds`.
- Settings: create the provider through a path operation at `providers.github-copilot`.
- Per-model API: materialize each account model as `{ id, api }`; never flatten a mixed route to route-level connection fields.
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
pnpm test
pnpm typecheck
pnpm verify:baseline
pnpm build
pnpm verify:package
pnpm pack --pack-destination artifacts
```

`pnpm verify` is the normal complete gate. Use a focused `vitest run <files...>` while iterating, then run the complete gate before commit. CI runs frozen install, `pnpm verify`, and package creation on Windows and Linux.

The rc.2 development dependencies remain the installable compiler/runtime baseline. CI separately checks out the exact alpha.1, controlled rc.2, and rc.1 upstream commits and runs `pnpm verify:upstream -- dsh-upstream` to verify every public seam this plugin consumes.

## Changing capabilities

1. Identify the owning seam above; do not duplicate an upstream owner.
2. Add or update focused tests before changing deployment claims.
3. Update both READMEs when user behavior, setup, migration, or boundaries change.
4. Update `deployment-baseline.json` and its verifier for a new required capability or export.
5. Build before package smoke; never hand-edit `lib/`.

## Issue, branch, and PR workflow

- Every change starts from a tracking issue.
- Work on a feature branch; never commit directly to `main`.
- Commit messages reference the issue and include the repository-required co-author trailer.
- Run the complete verification gate before pushing.
- Push the feature branch and open a PR targeting the resolved default branch with `Fixes #<issue>`.
- Do not merge unless explicitly requested.

GitHub operations must use the repository owner's intended authenticated identity. Never print tokens or embed them in commands.
