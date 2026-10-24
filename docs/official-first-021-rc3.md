# DSH 0.2.1-rc.3 compatibility

DSH `0.2.1-rc.3` is a prerelease. This plugin line targets the exact official
tag `dsh-v0.2.1-rc.3` at
[`1f81c047fc48fa190a683e469daa699857e9afe8`](https://github.com/deepseek-ai/deepseek-harness/commit/1f81c047fc48fa190a683e469daa699857e9afe8).
It is not a recommendation to upgrade a production Core or Desktop.

## Verified source differences

The public [`WebRuntime` source at the pinned commit](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/web/web/src/index.ts)
requires both `searchProvider` and `fetchProvider` as `Volatile<string |
undefined>` configuration values and reads each with `.get()`. The constructor
requires the config object rather than defaulting to `{}`. Passing the old
plain-string object can fail typechecking and can reach `.get is not a
function` at runtime. The plugin therefore supplies plugin-owned, read-only
`get()` references to its bounded runtime and passes explicit config to the
wrapped public runtime.

The experimental Auto reviewer remains qualified only when the package owner,
exact package version and imported `apply` callback match the native Loader
root. The exact rc.3 source fixture exercises that identity boundary; adding a
version string alone is not sufficient evidence.

The rc.3 source metadata pins Cordis `4.0.5`, cordis-plugin-loader `1.0.6`,
schemastery `3.18.5`, pi-ai `1.1.0` and Zod `4.4.3`. The plugin uses those
exact framework/schema versions for this target.

## Qualification status and limits

The Windows/Linux CI configuration is required to run both the unchanged
tagged-source regression suite and an isolated fixture against exact published
rc.3 artifacts. The fixture verifies package versions, peer resolution, public
class identity, typechecking and synthetic adapter/reviewer behavior. It makes
no real sign-in or provider request. Do not report rc.3 as qualified until the
required CI jobs pass. npm registry access was unavailable during local setup,
so local lockfile generation and published-artifact inspection have not been
verified.

Local lockfile generation is pending the package-age window, not established as
an artifact-availability failure. The official GitHub prerelease was published
at `2026-10-23T15:26:39Z`; the trusted-feed resolution attempted at approximately
`2026-10-24T08:00Z` was still within pnpm 11.7.0's inherited 1440-minute
`minimumReleaseAge`. The feed returned `ERR_PNPM_NO_MATCHING_VERSION` for an
rc.3 package, which can result from that age filter and does not prove that the
version is absent. Direct npm registry access failed at the network/TLS layer,
so per-package publication timestamps and integrity values have not yet been
independently verified. Retry the unchanged resolver after the conservative
24-hour boundary; do not alter the age policy, hand-edit integrity data, or
weaken exact-version guards. Until resolution succeeds, `pnpm-lock.yaml` remains
on the prior dependency set and is not synchronized with this candidate
manifest.

Desktop artifacts/signatures and runtime package composition are unverified.
No live install, restart, credential flow or model/search request is authorized
or implied. No DSH Core source, build or dependency artifact is changed.

Track the adaptation and its acceptance gates in [#432](https://github.com/cloga/dsh-github-copilot/issues/432).
