# Contributing

## Scope first

Read [AGENTS.md](./AGENTS.md) before changing code. This repository is a narrow companion to DSH's built-in `@deepseek-ai/dsh-llm-pi-ai`; do not add a second general Copilot adapter, catalog, credential store, external gateway, or sandbox owner. Exact temporary model compatibility remains constrained by the documented account/ownership gates.

Use a tracking issue to describe the problem and owning seam. Security-sensitive reports belong in [private vulnerability reporting](./SECURITY.md), not a public issue. Use native DSH tools, local Git and the GitHub REST API; no external orchestrator or special VCS tool is required.

## Change workflow

1. Determine `pwd`, Git status, remote and actual default branch. Preserve other people's changes. Start a feature branch such as `feature/issue-73-agent-readiness`; branch names need not contain an owner name.
2. Read `node scripts/agent.mjs describe --json` and run `node scripts/agent.mjs doctor --json`. These are read-only repository diagnostics, not live health checks. Plans from `node scripts/agent.mjs plan <task> --json` contain unexecuted argv lists.
3. Use Node 24 LTS for development (runtime floor: 22.19.0), the pinned pnpm version, and frozen install inside the checkout/worktree.
4. Add focused regression tests before changing capability claims. Keep READMEs, deployment evidence and the Agent task map aligned.
5. State expected outcomes and scope; run:

   ```sh
   pnpm install --frozen-lockfile
   pnpm verify
   pnpm pack --pack-destination artifacts
   ```

   Validate the resulting exact path with `pnpm verify:tarball -- artifacts/dsh-github-copilot-<package-version>.tgz`. The release task plan supplies that path automatically. Never run broad cleanup on an existing artifacts directory just to package again.
6. Inspect the complete diff, compare expected versus actual results, and report what was NOT checked. Source markers, stubbed unit tests, built module imports, upstream config fixtures, authenticated API calls, installation, and loaded UI are different evidence layers.
7. Commit with the issue reference and accurate attribution. For work assisted by DSH use `Assisted-by: DeepSeek Harness (DSH)`. Other agents must name the actual tool; do not infer authorship from the model vendor or copy a bot identity. Add `Co-authored-by` only for real verified collaborators. No fabricated email, author replacement or published-history rewrite.
8. Push the feature branch and open a PR containing `Fixes #<issue>`, verification, risks and rollback. Merge only with explicit approval and after all Windows/Linux x controlled-rc.2/rc.1/alpha.1 CI jobs pass.

Generated `lib/` output, archives, `.env`, tokens, local credentials, machine state and production screenshots with real authorization codes must not be committed. Use synthetic fixtures for screenshots and report staged UI honestly.

## Release changes

GitHub Releases are the only distribution channel. Do not publish this package to npm or remove `private: true`.

Release, local installation, sign-out and worktree checkout need separate explicit approval; finishing a PR is not permission. A release change keeps `package.json`, `deployment-baseline.json`, both README URLs and a fresh annotated `v<version>` tag aligned. New versions use SemVer alpha/beta/rc labels, not user names. Never move or reuse a tag.

After the version PR merges, an authorized maintainer tags the verified main commit. The tag-triggered workflow waits for the reusable full CI matrix on that revision, then builds, tests, packs, inspects the archive, writes `SHA256SUMS` and publishes. Do not hand-upload a locally built replacement or bypass failed CI.

After publication, independently verify the Release is not a draft, its prerelease flag, exact tag/commit, asset names and downloaded SHA-256. An install command must include the target `--profile`; never overwrite a shipped preset. Compare the installed package to the downloaded asset, then separately validate activation after restart. HTTP 200 alone does not prove the new plugin loaded.
