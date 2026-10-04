# Distribution and installation

Every new version is distributed through an immutable GitHub Release and public
npm, using the **same original verified tarball**. Package bootstrap is complete;
subsequent publication uses the configured OIDC Trusted Publisher. Earlier
Release-only policy and one-time bootstrap tooling are historical.

## Authorization and readiness

Use approved registry access and build environments.
A blocked corporate registry is not authorization to use a VPN, proxy, mirror,
personal device or CI as a bypass. Local synthetic registry tests do not prove
connectivity, publication rights or live Desktop compatibility.

Versions align package, deployment baseline, both README URLs and annotated tag.
Channel is `alpha`, `beta`, `rc` or stable `latest`; never silently rename a
package, move/reuse tags, repack immutable assets or publish placeholders.

## Trusted publishing

[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) requires npm
>=11.5.1 and Node >=22.14.0. Publishing uses Node 24 and pinned npm 11.5.1;
development retains the package's pnpm pin.

| Publisher field | Value |
|---|---|
| Provider | GitHub Actions, GitHub-hosted runner |
| Owner / repository | `cloga` / `dsh-github-copilot` |
| Workflow | `ci.yml` caller, not reusable `release.yml` |
| Environment | Unset |
| Allowed action | Direct `npm publish` |

Caller and reusable workflow grant `id-token: write`. No normal release uses
`NPM_TOKEN` / `NODE_AUTH_TOKEN` or persistent-token fallback. Direct publication
permission is explicit, not implied by a stage. Staged publication is separately
approved, pending npm maintainer review/2FA, not live; it reserves the version.
[`npm stage publish`](https://docs.npmjs.com/cli/v11/commands/npm-stage/) requires
an existing package and cannot bootstrap one. Do not change auth/2FA policy to
repair publication.

## Same bytes, recovery and tags

The non-cancelling repository release concurrency group serializes publication.
External publishers must coordinate; dist-tags are not atomic CAS.

After the complete compatibility gate, pack once with
`pnpm --config.ignore-scripts=true pack --pack-destination artifacts`.
Verification already built/prepacked. Recovery downloads the original uploaded
archive, verifies tag/source, size/digests, SHA-256/SHA-512 and build equality,
and never repacks/overwrites immutable bytes. Release assets include
`SHA256SUMS`; npm receives that same archive with lifecycle scripts disabled.

Only registry E404 establishes absence. Auth, TLS, malformed metadata and network
failures stop delivery. Existing exact versions require matching SRI and a
same-channel tag at that version or newer; conflicting bytes fail closed.
Visibility can lag a successful write. After successful/uncertain publication,
wait for visibility and reconcile read-only; **never automatically republish**.
A missing/older tag needs review, not a hidden dist-tag write.

SemVer ordering prevents downgrades. Missing older releases are not published
when their channel already points newer; reconciling existing older bytes never
lowers the pointer. Report GitHub tag/commit/assets/SHA-256 and npm version/SRI
separately. One channel succeeding is partial delivery.
[Read-only reconciliation](./npm-publication-readback.md).

## Installation preflight still applies

Desktop's native package manager accepts an exact verified npm spec, not a URL
or local archive. Generic/global CLI entry points must not be assumed to manage the reserved
`desktop` profile. Qualify Desktop's dedicated entry below.

Neither entry replaces the checksum-verified package's
`scripts/check-search-composition.mjs` preflight. Official `composeProfile()`
writes the empty `cordis.yml` root during normal launch, including resolved
Desktop profiles. `NONEMPTY_DISPOSABLE_PROFILE_ROOT` must therefore stop
installation/startup until its contents are preserved and reviewed.

A nonempty root may be reconstructible from existing bundles and persistent
patches, but must never be assumed disposable. Establish complete equality
through public composition and recheck source hashes before any separately
approved normalization. Installation approval is not blanket configuration
deletion approval. Check actual shared-peer resolution for stale profile-local
shadows; do not patch/copy peers as a plugin compatibility workaround.

### Desktop-bundled CLI on official rc.2

Read-only inspection of official `@deepseek-ai/dsh-desktop-host@0.2.0-rc.2`
`lib/cli.js` confirms `runDesktopCli` calls public `runCli` with
`manageDesktopProfile: true` and bundled pnpm through Electron Node mode.
This capability is specific to the qualified entry, not a global shim or an
unverified future release.

Resolve the intended installation's `resources\runtime\cli\bin\dsh.cmd`, verify
its owning version/public entry and exact profile/home/anchor; do not rely on
PATH. With explicit installation approval, verified bytes and `supported: true`:

```powershell
& '<verified Desktop installation>\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add '<absolute path to verified release.tgz>'
```

This example grants no action permission or universal offline guarantee.
Dependencies still require an approved registry or complete authorized cache.
CLI support does **not** override composition safety: when preflight fails,
no add, root rewrite or
restart followed merely to get past that diagnostic is authorized.
Use one writer, a private metadata backup, guarded edits and full package/bundle/
patch/peer readback. Installed-on-disk and loaded runtime remain distinct.
Stopping/restarting requires separate restart approval.

## Controlled offline CLI maintenance for standalone profiles

This installs a prebuilt verified Release using existing authorized caches;
it is not permission to bypass organizational registry restrictions.
It does not fix TLS or prove public npm health. **Do not use this path
unchanged for a Desktop-managed/reserved profile**: qualify Desktop's own entry
and retain independent preflight/approval checks.

1. Obtain explicit installation approval for exact version/profile. Resolve
   standalone CLI, install anchor, home and profile; do not infer ownership from
   PATH or target reserved Desktop with a generic entry.
2. Verify original Release bytes with an independently trusted SHA-256,
   package name/version and safe archive layout. Extract only that artifact,
   never a substitute local build or repack.
3. Run `scripts/check-search-composition.mjs` with all startup patches and require
   `supported: true`. Unknown/conflicting composition stops before mutation.
4. Keep one writer. Take a private backup of package/lock/bundle/patch metadata
   and record rollback bytes. Do not copy credential stores, `.env` or browser
   storage. Host shutdown needs separate permission.
5. Invoke the qualified CLI:

   ```sh
   dsh plugin --profile web add /absolute/path/to/verified-release.tgz --offline --ignore-scripts
   ```

   Offline needs existing cache; ignore-scripts excludes uncontrolled lifecycle
   work. If cache is incomplete or a build is required, stop. Do not silently
   remove flags, change registry or acquire blocked dependencies elsewhere.
   Keep TLS verification enabled; platform refusals remain authoritative.
6. Check exit result, installed version, lock/files and all metadata differences.
   Re-run preflight and import-only smoke without plugin activation. CLI may
   reconcile `dsh.profile.bundles`; preserve unrelated entries and review
   unexpected changes. Use package manager, never manual node_modules copying
   or Core patches. A failed command is not proof nothing changed.
7. Report version/checksum/backup and evidence limits. Obtain restart approval,
   then separately verify loaded build and intended behavior.

Rollback needs fresh-state review and narrow restoration of this operation's
changes, never a whole backup over later user edits. This procedure grants no
future-update permission or machine-wide network policy change.
