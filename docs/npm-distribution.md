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

## Exact-Core release lines

Each exact DSH Core starts its own plugin sequence at
`0.1.0-alpha.1.dsh.<normalized-Core>`; fixes for that Core increment `alpha.N`.
Core `0.2.1-alpha.5` therefore starts at
`0.1.0-alpha.1.dsh.0.2.1.alpha.5`, not a new global plugin minor. This is
numbering only: implementation, Git history and reviewed compatibility evidence
continue. No old release/tag is renamed or reused.

`deployment-baseline.json.releaseLines` is the explicit selection map. It retains
published anchors Core `0.2.0-rc.2` → plugin `0.4.2-alpha.15` and Core
`0.2.1-alpha.4` → plugin `0.4.2-alpha.16`; the alpha.5 line is **pending**.
Run `node scripts/select-core-release.mjs <exact-Core>` in a current source
checkout or verified package. This read-only command looks up the mapped exact
GitHub Release and npm version; it verifies the non-draft release, prerelease
flag, named tarball/checksum assets and exact npm `engines.dsh` before returning
an npm spec and Release/archive URLs. A missing pending entry reports pending;
a Release without observable npm bytes reports incomplete; unknown Core
versions fail explicitly. Network/auth/invalid metadata errors stop without a
recommendation. This map is a reviewed snapshot, not an automatic updater hook.

Release validation checks the suffix against exact `engines.dsh`, baseline and
Core peer metadata. It permits a lower numeric plugin version only for a new
exact-Core line starting at alpha.1 with the previous published anchor retained;
same-Core downgrades remain forbidden. Historical releases without a suffix stay
valid historical anchors, not guessed current compatibility.

The shared npm `alpha` pointer is chronological distribution state, **not**
compatibility-aware selection, and can move to a lower SemVer for an explicitly
mapped independent Core line. Never install from global `latest`/`alpha` or
choose the global maximum without checking the exact-Core mapping. No new npm
channels or old-Core maintenance commitment is introduced.

Read-only inspection of official alpha.5 CLI `apps/cli/src/plugin.ts`,
`packages/boot/plugin-manager/src/operations.ts` and native boot compatibility
contracts establishes install-spec handling and exact engine admission.
Registry specs use pnpm's selected version and engine preflight; git/tarball
specs rely on post-fetch admission. These are not consumption of this
plugin-owned map. No compatibility-aware
native updater integration is qualified here. Continue to use separately approved
exact-version/profile commands and the applicable Desktop CLI/preflight checks;
the suffix alone does not make an incompatible package safe or migrate a profile.

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
When the tagged package declares `releaseNotes: "CHANGELOG.md"`, publication
uses only the exact matching version section from that tracked checkout.
Reconciliation requires the identical body; older tags without that declaration
retain their original `Release v<version>.` body. A warning must never be added
to an old Release in a way that breaks its immutable provenance checks.

Only registry E404 establishes absence. Auth, TLS, malformed metadata and network
failures stop delivery. Existing exact versions require matching SRI and a
same-channel tag at that version or newer; conflicting bytes fail closed.
Visibility can lag a successful write. After successful/uncertain publication,
wait for visibility and reconcile read-only; **never automatically republish**.
A missing/older tag needs review, not a hidden dist-tag write.

Within one exact-Core line, SemVer ordering prevents downgrades. A new mapped
Core line may start lower than the historical global pointer; the publisher uses
the archive's explicit mapping or exact published package engine metadata, never
the suffix alone, to distinguish that transition. Unknown metadata fails closed.
Reconciling existing older bytes never changes the pointer. Report GitHub tag/commit/assets/SHA-256 and npm version/SRI
separately. A stable release may advance `latest` from a prerelease only when
that pointer names a prerelease of the exact same SemVer core version; other
cross-channel pointers and newer versions still fail closed. One channel
succeeding is partial delivery.
[Read-only reconciliation](./npm-publication-readback.md).

An unmapped, already-published alpha pointer may retain historical numeric
numbering such as `0.4.2-alpha.19.dsh.0.2.0.rc.2`. Its exact registry package
name/version and `engines.dsh` must verify the complete DSH suffix, without
requiring old bytes to adopt the new target's `0.1.0` numbering. Missing or
mismatched metadata still fails closed; new target validation and same-Core
monotonicity are unchanged. For publisher-only recovery changes after an
immutable release, the existing release plan selects the original annotated
tag's source SHA. The normal workflow recovers its original archive and uses
the separately checked-out current publisher only after byte comparison; it
never binds the immutable tag to the publisher revision or repacks the release.

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
