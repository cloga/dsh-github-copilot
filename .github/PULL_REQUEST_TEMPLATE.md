## Summary

<!-- Problem, owning seam, user intent, scoped changes. -->

## Expected vs Actual

<!-- Expected outcome and scope, actual commands/results. Do not check unrun commands. -->

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm verify` (source/test types, Agent contract, tooling tests, clean build, import smoke)
- [ ] `pnpm pack --pack-destination artifacts`
- [ ] `pnpm verify:tarball -- artifacts/dsh-github-copilot-<package-version>.tgz`
- [ ] All Windows/Linux x controlled-rc.2/rc.1/alpha.1 CI checks passed

### Evidence limits

<!-- List what was not checked: actual DSH activation, browser interaction, account availability, model stream, search, remote release, local installation. Synthetic screenshots must say so. -->

## Contract checklist

- [ ] No second general adapter/catalog, credential store, gateway or sandbox owner.
- [ ] Credential payloads stay Host-only; no real grant, device code or sensitive response appears in fixtures, logs, screenshots or this PR.
- [ ] Both READMEs, Agent contract, baseline and tests match changed behavior.
- [ ] Release metadata and URLs stay aligned if version changed.
- [ ] Attribution names the actual tool (`Assisted-by: DeepSeek Harness (DSH)` for DSH); no copied vendor bot or fabricated Co-authored-by identity.

## Risks and rollback

<!-- Files/owned leaves affected, migrations, what reverses the change, remaining limitations. -->

## Approval boundary

<!-- Opening this PR does not authorize merge, release, profile installation or worktree checkout. -->

Fixes #
