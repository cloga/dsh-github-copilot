# Contributing

## Scope first

Read [AGENTS.md](./AGENTS.md) before changing code. This repository is a narrow companion to DSH's built-in `@deepseek-ai/dsh-llm-pi-ai`; do not add a second general Copilot adapter, catalog, credential store, external gateway, or sandbox owner. Exact temporary model compatibility remains constrained by the documented account/ownership gates.

Use a tracking issue to describe the problem and owning seam. Security-sensitive reports belong in [private vulnerability reporting](./SECURITY.md), not a public issue. Use native DSH tools, local Git and the GitHub REST API; no external orchestrator or special VCS tool is required.

## Plugin-only delivery

Follow the **plugin-only** boundary in [AGENTS.md](./AGENTS.md#plugin-only-implementation-boundary). Fixes must live in this plugin and use existing published public APIs. Do not modify Core source, patch installed Core or `node_modules`, monkey-patch Core internals/shared catalogs, or prepare Core PRs/releases as part of this work. A new Core export or patch being merged is not an acceptable plugin delivery prerequisite.

Core inspection is read-only. Isolated tests may use unchanged pinned Core artifacts and owned temporary fixtures, never edits to tracked Core implementation or a live deployment. If an API is insufficient, document the limitation and a plugin-local alternative; do not silently move the task into Core. A separate, explicit human Core task is required for any future Core work—generic compatibility or optimization requests do not authorize it.

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
8. Push the feature branch and open a PR containing `Fixes #<issue>`, verification, risks and rollback. Merge only with explicit approval and after all Windows/Linux x controlled-rc.2/rc.1/0.1.3-alpha.1/0.1.5-alpha.1/0.1.5-alpha.2 CI jobs pass.

Generated `lib/` output, archives, `.env`, tokens, local credentials, machine state and production screenshots with real authorization codes must not be committed. Use synthetic fixtures for screenshots and report staged UI honestly.

## Release changes

GitHub Releases are the only distribution channel. Do not publish this package to npm or remove `private: true`.

Important user-requested features, behavior fixes, compatibility fixes, and security or stability fixes include release follow-through by default after authorized merge and green required CI. Do not stop at the merged PR or ask for a second release confirmation. User instructions limiting delivery to code/review or forbidding publication take precedence; documentation-only, internal-only and unrelated releases are not implicitly authorized. Follow the [important-update delivery rule](./AGENTS.md#important-update-release-delivery).

Prepare version alignment in the implementation PR. Important runtime or delivery changes fail the `release-ready` PR check unless `package.json` is strictly newer than the base and `deployment-baseline.json` plus both README install URLs agree. Retain the current prerelease channel unless promotion is requested. Docs/tests-only changes may keep the current version. Never move or reuse a tag. Local installation, sign-out and worktree checkout still need explicit approval; restarting active Sessions requires acknowledgement of the interruption.

After the release-ready PR merges, the successful main CI run calls the reusable Release workflow on that exact SHA. It creates or reconciles the annotated version tag and a draft-first Release, rebuilds and verifies the package, writes and verifies `SHA256SUMS`, checks remote asset digests, and only then publishes an immutable Release. Identical reruns reconcile safely; conflicting tags, releases or bytes fail closed. A tag created by `GITHUB_TOKEN` does not trigger a second workflow, so publication occurs in the gated main workflow rather than depending on recursive tag events. Do not hand-upload a replacement or bypass failed CI.

Release-bearing work is complete only after reporting the published Release URL and verified version/commit/assets/checksum, or clearly identifying a concrete publication blocker and pending step. A merged PR or a local tarball alone is not release delivery. After publication, independently verify the Release is not a draft, its prerelease flag, exact tag/commit, asset names and downloaded SHA-256. An install command must include the target `--profile`; never overwrite a shipped preset. Compare the installed package to the downloaded asset, then separately validate activation after restart. HTTP 200 alone does not prove the new plugin loaded.
