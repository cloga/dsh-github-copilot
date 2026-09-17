# Read-only publication reconciliation evidence

Use `.github/workflows/verify-published-npm.yml` when an existing approved publication returned an uncertain result and direct local public-registry readback is unavailable. This is ordinary repository CI verification in the existing approved publication environment, not a network proxy or a way to acquire locally blocked dependencies.

## Boundaries

- Permissions are only `contents: read`; there is no OIDC grant, npm credential, publishing command, tag write, lifecycle install, profile mutation, repack or automatic repair.
- Inputs are an exact package version and expected immutable source SHA. The package and GitHub repository are fixed; arbitrary URLs and commands are not inputs.
- Validate the immutable non-draft Release, annotated tag/source, exact original archive/checksum asset digests and sizes, and original SHA-256/SHA-512. Never execute downloaded package code.
- Query public npm with normal TLS and no fallback registry. Compare exact name/version/dist.integrity and require a same-channel dist-tag at the version or newer. Record a small owned receipt with actual evidence and a clear failure classification. A 404 from a corporate mirror is not public npm absence.
- Only the minimal JSON receipt is uploaded. Do not upload grants, tokens, signed asset redirect URLs, arbitrary raw response bodies or the downloaded package archive.

## Review and triggering

Prepare changes in a **draft PR**. Its readback job is skipped; ordinary PR unit/compatibility tests may run. After independent code and permissions review, marking the PR ready triggers the explicitly registered `ready_for_review` event and the read-only job. This route is important: merging an internal verifier change would also trigger normal main CI and automatic publisher reconciliation, which must not happen before the uncertain version's read-only evidence is known.

Once the workflow is on the default branch, its `workflow_dispatch` entry may verify another explicitly selected existing version/source. The dispatch is still read-only and cannot recover or publish a release.

## Recovery decision

A matching visible version/SRI and non-decreasing channel receipt may support a separately authorized rerun of the established publisher, which must recover the same original immutable archive and reconcile it read-only. Missing or mismatching data, credentials/TLS failure, a stranded tag or unverified provenance is not permission to republish, weaken checks or alter credentials. Preserve the failure receipt, original release bytes and exact workflow/source identity for review.

For `0.4.0-alpha.25`, the target is source `5458fda2854d5956e0c8d68a0f0b0a6e55833c8b`. The first main pipeline published the immutable GitHub Release but ended with `npm version integrity differs or is not yet observable; no overwrite or automatic retry`. That error alone does not establish whether the npm write succeeded. The read-only verifier supplies the missing evidence without changing either distribution channel.
