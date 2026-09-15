## Summary

<!-- Problem, owning seam, user intent, scoped changes. -->

## Expected vs Actual

<!-- Expected outcome and scope, actual commands/results. Do not check unrun commands. -->

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm verify` (source/test types, Agent contract, tooling tests, clean build, import smoke)
- [ ] `pnpm pack --pack-destination artifacts`
- [ ] `pnpm verify:tarball -- artifacts/dsh-github-copilot-<package-version>.tgz`
- [ ] All Windows/Linux x controlled-rc.2/rc.1/0.1.3-alpha.1/0.1.5-alpha.1/0.1.5-alpha.2/0.1.5-rc.1/0.1.5-rc.2/0.1.6-alpha.1 CI checks passed

### Evidence limits

<!-- List what was not checked: actual DSH activation, browser interaction, account availability, model stream, search, remote release, local installation. Synthetic screenshots must say so. -->

## Contract checklist

- [ ] **plugin-only**: no Core source/artifact changes, `node_modules` patches, private-registry/prototype/shared-catalog mutation, or Core commit/PR/release work.
- [ ] Uses existing published public APIs; delivery does not depend on a new Core export or Core patch. Missing capabilities have an explicit limitation or plugin-local alternative.
- [ ] No second general adapter/catalog, credential store, gateway or sandbox owner.
- [ ] Credential payloads stay Host-only; no real grant, device code or sensitive response appears in fixtures, logs, screenshots or this PR.
- [ ] Both READMEs, Agent contract, baseline and tests match changed behavior.
- [ ] Release metadata and URLs stay aligned if version changed.
- [ ] Attribution names the actual tool (`Assisted-by: DeepSeek Harness (DSH)` for DSH); no copied vendor bot or fabricated Co-authored-by identity.

## Risks and rollback

<!-- Files/owned leaves affected, migrations, what reverses the change, remaining limitations. -->

## Release delivery

- Classification: important update / documentation-only / internal-only / explicitly release-scoped.
- Prepared version and release channel:
- User delivery restrictions, if any:
- After authorized merge: important updates continue through green required CI, a fresh tag and verified Release without another release prompt.
- Published Release URL + tag/commit/assets/SHA-256, or concrete blocker and pending step (update after release):

## Approval boundary

<!-- Opening this PR does not authorize merge, profile installation, sign-out, worktree checkout or interruption of running Sessions. Important-update publication follows AGENTS.md's standing delivery rule; other releases need an explicit request. -->

Fixes #
