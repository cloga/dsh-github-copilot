# Default dual distribution

Refs #43. This change supersedes the original Release-only distribution decision
at the user's request; that closed issue did not originally request npm.

Every new version is distributed through both an immutable GitHub Release and
the public npm registry. The name `dsh-github-copilot` remains provisional until
an authorized maintainer verifies availability or ownership. Never publish an
empty placeholder package, reuse historical alpha.17, change immutable assets,
or describe a local archive as a published package.

## Authorization and readiness

Use only organizationally approved registry access and build environments.
A blocked corporate registry is not authorization to use a VPN, proxy, mirror,
personal device or GitHub Actions as a bypass. Obtain the applicable approval
before any registry traffic or publication. Local tests use synthetic registry
responses; they do not establish registry connectivity, ownership or live
Desktop compatibility.

Before the first release, confirm the package name and the maintainer's write
access, public repository visibility, 2FA, approved publication environment, and
the next unused version in both registries. Only then merge the prepared version
through the normal reviewed PR path. Version changes include package.json,
deployment-baseline.json and both README URLs; `publishConfig.tag` must agree
with the channel. Do not silently rename a taken package.

## First package bootstrap is a maintainer operation

The normal main pipeline publishes the GitHub Release first, then requires npm
publication. Until bootstrap/trusted publishing is configured, the npm step
fails explicitly and the workflow is **not fully delivered**. This is intentional,
not a successful skipped step. The already published GitHub archive is retained.

For the already released `v0.4.0-alpha.18`, `.github/workflows/bootstrap-npm.yml`
is a one-time `workflow_dispatch` follow-up. It is fixed to Release commit
`08bfccc3b5930b93ef2fe31d9cf9e509f34a8704`, the original Release asset
digests, and the expected npm SRI. It downloads and validates the immutable
Release rather than packing workspace bytes. Only the publish step receives the
repository `NPM_TOKEN`, as `NODE_AUTH_TOKEN`; GitHub access remains read-only and
the normal release pipeline remains OIDC-only.

The bootstrap reads package, version, and alpha-tag state before any write. A
matching existing version is read-only; an existing package without this exact
version stops for maintainer ownership review. True package absence allows one
exact publish command with lifecycle scripts disabled and no automatic retry.
An OTP/2FA requirement fails honestly; do not bypass or disable 2FA. After a
successful first publication and Trusted Publisher setup, remove both this
workflow and the repository `NPM_TOKEN`.

1. From the verified immutable Release, obtain its original versioned tarball
   and `SHA256SUMS`. Verify the annotated tag/commit, Release state, asset digest,
   archive contents and SHA-256. Do not repack or edit this archive.
2. In an approved environment, the authorized maintainer verifies `npm whoami`
   is the intended account (`cloga`) and performs the first ordinary
   `npm publish <original-release.tgz> --access public --tag alpha --ignore-scripts --registry=https://registry.npmjs.org/`
   with interactive 2FA or explicitly authorized legitimate publishing
   credentials. `<original-release.tgz>` is the exact downloaded real artifact,
   not a directory or placeholder. Do not print, copy or commit credentials, or
   weaken 2FA to make this succeed.
3. Read back the exact npm version and compare `dist.integrity` with the
   archive's SHA-512 SRI. Configure trusted publishing, then rerun the failed
   CI release job on its original revision. It recovers the same bytes and
   verifies the existing npm version without another publish.

**`npm stage publish` cannot bootstrap a nonexistent package.** The
[official npm stage prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-stage/)
require the package to already exist. For an existing package, staged publishing
is an optional separately approved process: a maintainer reviews Staged Packages
on npmjs.com and approves with 2FA. Staged is **pending approval**, not npm live.
It reserves the version; a conflicting normal publish must fail, not reject or
overwrite the stage automatically. Approval can update its immutable chosen
dist-tag, so review channel ordering again before approval. This repository does
not add a long-term manual/opt-in step to normal releases.

## Trusted publishing for subsequent versions

[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) requires
npm CLI >=11.5.1 and Node >=22.14.0. The publishing workflow uses Node 24 and
pins npm 11.5.1; package development retains the pinned pnpm version.

In the package settings, an authorized maintainer configures:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions, GitHub-hosted runner |
| Organization or user | `cloga` |
| Repository | `dsh-github-copilot` |
| Workflow filename | `ci.yml` (the caller, **not** `release.yml`) |
| Environment | Unset; the current release job declares none |
| Allowed actions | Enable direct `npm publish` |

Both caller and reusable child grant `id-token: write`. New trusted publisher
configurations may default to stage-only permission: direct publish permission
is an explicit maintainer choice, not implied by a successful stage. No
`NPM_TOKEN` or `NODE_AUTH_TOKEN` is configured in normal release CI; missing OIDC
fails loudly rather than falling back to persistent tokens. npm creates
provenance automatically for supported public-repository trusted publishes.
Do not change token/2FA policy as part of an automated repair.

## Same bytes, recovery and tags

The repository-wide release concurrency group serializes releases and remains
non-cancelling. External/manual publishers must coordinate with it: npm does
not provide atomic compare-and-swap for a dist-tag. Do not run concurrent manual
publishes or approvals while a release job is publishing.

After the full compatibility gate, a new release packs one tarball with
`pnpm --config.ignore-scripts=true pack --pack-destination artifacts`; verification
already ran prepack's baseline check and built the package, so packing does not
rebuild it. A retry
first inspects the existing exact tag/Release and downloads the original
uploaded archive. Recovery verifies asset sizes/digests, checksum and local
build equality; it never repacks or overwrites an existing archive. Partial
drafts with a tarball can recover their checksum; published incomplete or
non-immutable Releases fail closed. GitHub publishing reconciles its immutable
assets, and npm publishes the same archive with lifecycle scripts disabled.

The npm step reads package/version state before writing. Only E404 means
absence; auth, TLS, timeout, malformed metadata and registry failures stop
delivery. An existing exact version is accepted only with matching SHA-512 SRI
and a channel tag at that version or a newer one. Conflicting bytes fail closed.
An uncertain write is not retried in-process; rerun the workflow to reconcile.
A matching version with an older/missing tag requires maintainer review; the
workflow does not silently repair it with separate dist-tag writes.

`alpha`, `beta`, and `rc` versions use those tags, never `latest`. Stable
versions use `latest`. SemVer comparison (not lexical sorting) prevents tag
downgrades. Publishing a missing older version when its tag already points to a
newer version fails before writing; reconciling an already published older
version does not lower that pointer.

Report GitHub URL/tag/commit/asset/SHA-256 and npm version/channel/SRI separately.
GitHub success followed by npm failure is partial delivery, not success.
There is no historical bulk backfill and no silent npm opt-out.

## Installation preflight still applies

After both channels are verified, official Desktop accepts the exact
`dsh-github-copilot@<version>` npm spec in its package manager. It does not accept
the Release URL or local tarball in that UI. Follow the existing README
`scripts/check-search-composition.mjs` preflight before changing configuration;
the script remains in the package. A successful package lookup or install does
not prove runtime activation or a successful Copilot request.

For separately managed CLI profiles only, retain the required `--profile` on
`dsh plugin` commands. Never use the CLI to write a reserved Desktop-managed
profile, copy into node_modules, patch Core or restart active Sessions without
their separate approvals. Installed-on-disk and loaded-runtime evidence remain
distinct.
