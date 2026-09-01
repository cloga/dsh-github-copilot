# Agent guide

This file is the authoritative entry point for humans and coding agents. Read it before changing code.

## Product and architecture

`dsh-github-copilot` is a companion to DSH `0.1.2-alpha.3`. It does not own a general Copilot chat adapter. DSH's built-in `llm-pi-ai` mount owns the GitHub Copilot provider, catalog, OAuth flow, credential format, token exchange, refresh, and normal model transport.

This repository owns four narrow surfaces:

1. A Host authorization controller that joins DSH authorization, credentials, and settings.
2. A Client Models provider-card contribution and Client-safe Remote descriptors.
3. Safe creation of a reference-free `llm-pi-ai.providers.github-copilot` profile.
4. Direct provider-hosted search using the same Host-side credential lifecycle.

## File map

- `src/index.ts`: Host entry, injections, settings registration, listener, and `ctx.web` provider composition.
- `src/authorization-controller.ts`: sign-in/status/sign-out and route mutation.
- `src/copilot-auth.ts`: narrow pi-ai `CredentialStore` adapter over `llm-pi-ai/github-copilot`.
- `src/client.ts`: `settings.models.provider-card` UI keyed by `llm-pi-ai`.
- `src/remote.ts`: Typert Remote contribution. Never add credential payloads here.
- `src/current-provider.ts`: selected DSH route plus installed pi-ai catalog facts.
- `src/plan.ts`: Copilot-only, fail-closed hosted-search candidate lifecycle.
- `src/probe.ts`: bounded native-search capability proof.
- `src/wire.ts`, `src/wire-anthropic.ts`: inline hosted-search streaming.
- `src/traditional-search.ts`: `github-copilot-hosted` `ctx.web` provider.
- `src/serialize.ts`, `src/sse.ts`, `src/failure.ts`: protocol conversion and bounded error handling.
- `tests/`: unit and integration evidence; mirror the source area being changed.
- `deployment-baseline.json`: machine-readable compatibility and capability evidence.
- `scripts/verify-deployment-baseline.mjs`: invariant drift gate.
- `lib/`: generated release output; never edit it.

## Non-negotiable invariants

- Do not add a second general Copilot LLM adapter or model catalog.
- Do not require or silently support `copilot2api`, an external gateway, a pasted GitHub token, a placeholder key, or `dsh-web-search-provider`.
- The credential record key is `llm-pi-ai/github-copilot`.
- OAuth credential payloads stay Host-only. Client Remote methods may expose status, notices, and errors only.
- Refresh must run through pi-ai `Models.getAuth()` and DSH `credentials.modifyRecord()`.
- Settings changes are path-level. Never replace the whole `llm-pi-ai` section or unrelated provider profiles.
- Sign-out deletes only the Copilot credential record and keeps route settings.
- Hosted search only serves the selected `github-copilot` route, only for an account-available model and a native search protocol, after a successful probe.
- Misconfiguration and API drift fail loudly with a named missing seam. Do not fall back to process-local secrets or implicit machine state.
- Host, Client, and Remote package entries must stay independently buildable and exported.

## DSH alpha.3 seams

The supported upstream baseline is tag `dsh-v0.1.2-alpha.3`, commit `dd6322d604e00eec1ba5e0c8541159906a21094a`.

- Models slot: `settings.models.provider-card`, keyed by settings namespace `llm-pi-ai`.
- Authorization flow key: `llm-pi-ai/github-copilot`.
- Credentials: use record description/read/modify/delete APIs on the Host. Never read records in the browser.
- Settings: create the provider through a path operation at `providers.github-copilot`.
- Route activation: the dormant `llm-pi-ai` mount observes the profile and registers the route.
- Client activation: package metadata injects DSH remotes and Models UI; `./client` mounts `./remote`.

When upgrading DSH or pi-ai, inspect the exact tagged public exports and update the baseline, compatibility guard, tests, and docs together.

## Code and documentation conventions

- TypeScript is strict, ESM, and English-only for code, comments, test names, and `README.md`.
- `README.zh.md` is the Chinese user guide and should match the English product contract.
- Prefer existing helpers and narrow interfaces over casts or broad catches.
- Provider/network errors must not leak credentials or raw sensitive response bodies.
- Do not commit generated archives, temporary files, `.env` files, tokens, or local credentials.
- Keep design rationale in code/docs that enforce it; do not add empty templates or duplicate policy documents.

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

The alpha.3 DSH packages are not published in the configured npm registry, so the rc.2 development dependencies are compiler scaffolding only. CI separately checks out commit `dd6322d604e00eec1ba5e0c8541159906a21094a` and runs `pnpm verify:upstream -- dsh-upstream` to verify every public alpha.3 seam this plugin consumes. Do not describe rc.2 as runtime-compatible.

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
