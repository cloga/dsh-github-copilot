## Summary

<!-- Explain the problem, the owning DSH seam, and the narrow change. -->

## Validation

<!-- List focused tests plus the complete gate. -->

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm verify`
- [ ] `pnpm pack --pack-destination artifacts`
- [ ] Windows/Linux × controlled-rc.2/alpha.5 CI passes

## Contract checklist

- [ ] The change does not add a second Copilot adapter, catalog, credential store, external gateway, or sandbox owner.
- [ ] Credential payloads remain Host-only and errors contain no secrets or raw sensitive responses.
- [ ] `README.md` and `README.zh.md` remain aligned when user-visible behavior changed.
- [ ] Deployment-baseline evidence and compatibility guards were updated when an owned seam changed.
- [ ] Release metadata and URLs remain aligned when the package version changed.

Fixes #
