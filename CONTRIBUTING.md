# Contributing

## Scope first

Read [AGENTS.md](./AGENTS.md) before changing code. This repository is a narrow companion to DSH's built-in `@deepseek-ai/dsh-llm-pi-ai`; do not add a second Copilot adapter, catalog, credential store, external gateway, or sandbox owner.

Use a GitHub issue to describe the problem and the owning DSH seam before implementation. Security-sensitive reports belong in [private vulnerability reporting](./SECURITY.md), not a public issue.

## Change workflow

1. Start from the current default branch and create a non-default branch. For `cloga`-owned work, use `cloga-<task-slug>`.
2. Add or update focused tests before changing a capability claim.
3. Keep `README.md` and `README.zh.md` aligned when behavior, setup, compatibility, migration, or boundaries change.
4. Update `deployment-baseline.json` and its verifier when required evidence, exports, upstream seams, or the release version changes.
5. Run the complete gate:

   ```sh
   pnpm install --frozen-lockfile
   pnpm verify
   pnpm pack --pack-destination artifacts
   ```

6. Inspect the complete diff, commit with the issue reference and required co-author trailer, and open a pull request with `Fixes #<issue>`.
7. Merge only after the Windows/Linux × controlled-rc.2/alpha.5 matrix passes.

Generated `lib/` output, archives, `.env`, tokens, local credentials, and machine-specific state must not be committed.

## Release changes

GitHub Releases are the only distribution channel. Do not publish this package to npm or remove `private: true`.

A release change must keep `package.json`, `deployment-baseline.json`, both README URLs, and the annotated `v<version>` tag aligned. After the version PR merges and `main` is synchronized, an authorized maintainer creates and pushes that annotated tag. The tag-triggered Release workflow rejects lightweight or mismatched tags and owns verification, packing, `SHA256SUMS`, and Release creation. Never move or reuse a release tag.
