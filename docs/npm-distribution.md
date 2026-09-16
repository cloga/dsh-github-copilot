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

## Initial package publication is complete

The initial `dsh-github-copilot@0.4.0-alpha.18` package was published from the
immutable `v0.4.0-alpha.18` GitHub Release archive. The public registry version,
SHA-512 SRI, `alpha` tag, tarball size and SHA-256 were independently verified
against those original Release bytes. The one-time workflow, token-authenticated
bootstrap script and their focused tests have therefore been removed. No normal
release workflow references `NPM_TOKEN`; removing any now-unused repository
secret remains a separate explicit maintainer operation.

The successful publish was not immediately visible to a read performed about
four seconds later, so that workflow run ended as a failure even though the
package and tag subsequently converged. Treat this as an uncertain write, not
permission to publish again. npm registry package metadata and dist-tags are
eventually consistent: after any successful or uncertain publish command, wait
for the exact version to become observable, verify `dist.integrity` and the
non-decreasing channel tag, then rerun the normal pipeline to reconcile
read-only. Never retry a publish merely because immediate readback is stale.

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
An uncertain write is not retried in-process. Allow registry visibility to
converge, then rerun the workflow to reconcile the exact existing version.
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

The native Desktop package manager remains the preferred interactive entry
point when its registry access is permitted and available. After npm publication
is verified, it accepts the exact `dsh-github-copilot@<version>` npm spec, not a
Release URL or local tarball in that UI. This UI input restriction is not a
blanket prohibition on maintaining the same profile through the supported CLI.
Controlled CLI maintenance is also supported for Desktop-managed profiles under
the checklist below. Neither entry point replaces the package's required
`scripts/check-search-composition.mjs` preflight. A package lookup, preflight or
successful installation is not proof of runtime activation or a model call.

## Controlled offline CLI maintenance

This path installs this package's prebuilt, verified Release without requiring
access to a blocked npm registry. It is not permission to bypass organizational registry restrictions:
use only artifacts obtained through organizationally approved sources and
already available dependency caches. A registry ban remains in force; offline
installation does not repair TLS or prove that npm publication is healthy. The
dual-channel **publication** policy above is unchanged.

1. Obtain explicit installation approval for the exact version and profile.
   Resolve the actual DSH CLI, install anchor, `DSH_HOME` and profile directory;
   do not assume a shell shim points to the Desktop's current installation.
2. Verify the original Release tarball with an independently trusted SHA-256,
   its package name/version and safe archive layout. Do not substitute a local
   build or repack an existing immutable Release. Extract only the verified
   artifact before executing its packaged preflight.
3. Run `scripts/check-search-composition.mjs` against that exact profile, home
   and install anchor, including any extra startup patches. Require
   `supported: true`; unknown, conflicting or unsupported composition is a stop,
   not permission to remove guards or rewrite the profile.
4. Keep one writer: do not run Desktop package updates and CLI installation
   concurrently. Take a private backup of installation metadata (package.json,
   lockfile, bundle/patch configuration and relevant package-manager settings),
   record the current version, and retain a verified rollback artifact.
   Do not copy credential stores, `.env` files or browser storage. If ensuring
   exclusive maintenance requires stopping the Host, obtain separate approval.
5. Invoke the supported DSH CLI with an absolute path to the verified archive:

   ```sh
   dsh plugin --profile web add /absolute/path/to/verified-release.tgz --offline --ignore-scripts
   ```

   Replace `web` and the archive path with the approved targets. `--offline`
   requires the existing cache; `--ignore-scripts` prevents package lifecycle
   scripts from creating a second, uncontrolled installation/network path. If
   the cache is incomplete or a dependency requires a new build, stop and report
   the missing requirement. Do not silently remove these flags, change registry,
   add a VPN/proxy/mirror, or fetch blocked dependencies through another channel.
   Keep TLS verification enabled. Actual platform permission/approval refusals
   remain authoritative; this procedure does not override them.
6. Check the exit result and read back the installed version, lock entry and
   package files against the verified archive. Re-run the composition preflight
   and an appropriate import-only smoke check without activating the plugin.
   Inspect all metadata differences: the CLI reconciles `dsh.profile.bundles`
   and may add unrelated installed bundles. Preserve unrelated settings; stop
   for review on unexpected changes and revert only changes proven to belong
   to this operation, never overwrite later user edits with a whole backup.
   Use the package manager, not manual copying into node_modules or Core patches.
7. Report the installed version, checksum, backup and evidence limits. Obtain
   separate restart approval before interrupting the Host or active Sessions.
   Installed-on-disk and loaded-runtime are separate states: after an approved
   restart, verify the loaded build and the intended behavior independently.

If installation fails, inspect the actual installed state before retrying or
rolling back; a failed command is not proof that nothing changed. A rollback
also needs reviewed, narrowly scoped metadata/dependency restoration. This
documentation change does not rewrite installed or published historical docs,
change machine-wide registry policy, or grant blanket approval for future updates.
