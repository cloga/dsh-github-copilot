# Copilot accounts

## Delivery status

This document records the approved requirements and implementation design for
issues #297 and #305. Candidate behavior is not released or installed until the
acceptance gates below complete. The existing single-account behavior remains
the compatibility baseline. The current source candidate is `0.4.0-alpha.104`;
publication, installation and loaded runtime state are separate evidence.

## Requirements

- Keep multiple independently authorized GitHub Copilot accounts in one DSH
  profile. Models retains the global default. Sessions without an override
  inherit that default at each new turn; explicit Session choices take priority.
- Models alone manages authorizations. A low-frequency account selector inside
  existing Credits applies to this Session's subsequent turns. No standalone
  composer selector, one-turn override or DSH application identity replacement.
- Persist OAuth grants through the existing DSH credentials service. Use
  official pi-ai login, refresh and transport, not copied credentials, a token
  backup/refill scheme, a separate credential store, a second wire or Core edits.
- Preserve the existing `llm-pi-ai/github-copilot` record without moving or
  copying it. It is the compatibility account when no active account is stored.
  Newly added accounts are directly authorized into plugin-owned records.
- Changing the account must not change Session histories, selected models,
  future global defaults, model exclusions or billing/Usage records. A selected
  model unavailable to the new account fails explicitly, without substitution.
- Freeze an admitted turn's account before Auto assessment. Later Session/global
  choices do not redirect its steps, native retries or hosted search. Block
  reauthorization/removal of its pinned record until native turn end/disposal.
  Never cancel a running answer automatically. Explain that encrypted historical replay can be
  account-bound; do not silently remove replay or replay a message.
- No automatic fallback to another account on quota exhaustion, authorization
  failure, missing records or invalid settings.

## Public API evidence

Official DSH `0.2.0-rc.2`, commit
`639ed015397290b3745d163aafe02ffee4aa3f84`, exposes
`PiAiAdapterOptions.auth.credentials`. Its adapter source was compared
byte-for-byte with that commit. DSH `authorization.registerFlow()` registers a
flow per credential key; `credentials.modifyRecord()` serializes mutations.

Published pi-ai `0.87.1` accepts a public `CredentialStore` in `createModels()`.
`Models.login()` persists directly through that store. `Models.getAuth()`
refreshes OAuth under its serialized mutation; each account can supply an
independent store binding without changing provider IDs or model IDs.

An isolated experiment with unchanged pi-ai and synthetic in-memory stores
verified independent native login, no refresh for valid tokens, parallel
account-local refresh, captured-store stability after selection changes,
preservation after refresh failure, and independent logout. All HTTP was
mocked. This is SDK composition evidence, not live OAuth, DSH durable storage,
native gateway or model-call proof.

GitHub's authenticated `GET /user` returns the identity corresponding to the
GitHub authorization token. The current native OAuth requests `read:user`.
Its `refresh` field holds that GitHub token; the short-lived `access` field
holds a different Copilot request token. Never exchange their purposes.

The Copilot SDK `account.getQuota` contract at commit
`ef04633cc84e4ba8e79888a39259ca276f5de732` returns quota snapshots and accepts
an account selection identifier or GitHub token. It is an experimental
SDK/runtime RPC, not a pi-ai API or proof of cross-application AI credits.
This feature does not introduce another CLI runtime to obtain quota.

## Ownership extension

The user explicitly approved this limited extension of the previous
single-record policy:

- Official canonical credentials remain under their existing owner.
- The plugin may own additional `github-copilot/account-<opaque-id>` records,
  obtained by official OAuth writing directly into the target record.
- All records use the existing DSH credentials service and documented grant
  normalization. No credentials enter Settings, Client, Remotes, logs or docs.
- Official pi-ai remains the OAuth and refresh implementation owner. The plugin
  owns only account addressing, selection, lifecycle and safe presentation.
- This does not authorize Core changes, credential cloning, ambient credential
  discovery, copied upstream catalogs or a second general transport adapter.

## Account binding and persistence

Settings contain an opaque global active account identifier, written with a
path-level compare-and-swap in the existing `github-copilot` namespace. An
absent selector means the canonical compatibility account. An invalid selector
or missing selected record is an error, not permission to use canonical.
There is no persisted membership list: native `credentials.listRecords()`
enumerates record keys and kinds, while public identity stays in bounded
Host-memory cache. No usernames, grants or auxiliary account list are stored
in Settings. Hidden volatile `sessionAccounts` additionally persists bounded
`{sessionId, accountId}` overrides, changed through a separate path-level CAS.
Selecting the same account as the default is still an explicit override.
Choosing **Follow global default** removes only this Session's row.

A request captures an immutable account identifier, record key and selection
ownership. Its `CredentialStore.read/modify/delete` methods all refer to that
record. A mutable active-account lookup inside each store method is forbidden:
an A refresh must never commit into B after a switch.

Account identity uses GitHub host plus stable numeric user ID for duplicate
detection, not usernames or token strings. Identity reads are bounded,
Host-only, redirect-refusing and cancellation-aware. Normalize only required
public identity fields, discard unrelated `/user` fields, and reject results
whose credential/selection evidence changed during the read.
Host normalization and strict Remote decoding share the same bounded login
pattern. It accepts ordinary names and GitHub.com Enterprise Managed User names
with underscore-separated shortcodes, including setup admin names. This is not
support for a custom enterprise OAuth host; `enterpriseUrl` remains unsupported.
See [GitHub's official username rules](https://docs.github.com/en/enterprise-cloud@latest/admin/managing-iam/iam-configuration-reference/username-considerations-for-external-authentication).

Token refresh remains lazy. Inactive accounts need not hold fresh Copilot
tokens. Refresh uses native `Models.getAuth()` and the corresponding DSH record
mutation. Failure preserves the account's stored grant and does not affect
other records. Reauthorization targets the same account slot and must detect
unexpected identity replacement before activating it.

## Add and switch transactions

Adding an account runs native OAuth in an independent slot. It does not
overwrite or change the active account. Identity and model metadata validation
must complete before the new slot can be selected. Partial authorization is
reported truthfully and can be retried or explicitly removed.

Switching has a preparation phase and a commit phase:

Route eligibility reads official rc.2 SettingsForms through redacted
`describe()` values and revision-bearing namespaces; it does not require the
retired `get()` method. Missing or malformed configuration still means
incomplete evidence, not an absent native route. The legacy reader remains
available for retained compatibility fixtures. Account persistence acceptance
uses real SettingsForms and the production route diagnostic, without an
eligibility override.

1. Capture the selector revision and verify managed-only route eligibility.
2. Validate target identity, refresh authorization as needed and check account
   model metadata without publishing it as the active account.
3. Hold an admission fence during commit. Existing account-pinned managed
   turns may continue; unbound legacy preparation remains conservatively fenced.
4. CAS the selector, read back committed settings and confirm target evidence.
5. Update the default directory and UI without revoking another account's
   running turn/proofs or writing model/history/default selection. Credential
   replacement revokes only the matching account runtime and search/quota proof.

`COPILOT_ACCOUNTS_BUSY` is transient: each account status read reevaluates
current managed Agent activity, operation leases and authorization. A rejected
switch must not remain busy after that work settles. Reading status does not
refresh credentials or retry the rejected switch. In Models, use **Refresh
account information** after work ends to update the mounted view. With only
one saved account, first use **Add GitHub account**; a **Switch** control is
shown only for another saved account. No running work is cancelled for this.

`COPILOT_ACCOUNTS_BUSY` is transient: each account status read reevaluates
current managed Agent activity, operation leases and authorization. A rejected
switch must not remain busy after that work settles. Reading status does not
refresh credentials or retry the rejected switch. In Models, use **Refresh
account information** after work ends to update the mounted view. With only
one saved account, first use **Add GitHub account**; a **Switch** control is
shown only for another saved account. No running work is cancelled for this.

Failed preparation leaves the old selector unchanged. A committed selector
followed by failed readback is reported as uncertain, never successful and
never automatically rolled back. Cross-process/external mutations are guarded
by revisions and evidence checks; an in-process fence is not a cross-namespace
or cross-process transaction guarantee.

Operations include model preparation, Auto assessment, model discovery,
native auth refresh, managed answer streams and hosted search. Release leases
on completion, failure, cancellation and disposal. Switching never terminates
native retries, rewrites native retry policy or manufactures Usage.
An abandoned signal-free prepared call has no public completion/cancellation
evidence; it conservatively retains its barrier until disposal. A guessed idle
timeout must not permit switching under potentially live work.

## Route compatibility

Core's canonical route still reads its canonical record. Do not intercept
Core's store, mutate its prototypes or mirror selected grants into its record.
The first multi-account delivery therefore requires a managed-only profile.
Existing canonical configuration, running/selected legacy routes, or
incomplete route evidence blocks switching with a named diagnostic.

Any migration uses the existing separately approved, explicit configuration
workflow. Enabling accounts does not remove native profiles, rewrite stored
Sessions or silently migrate their route IDs.

Sign-out deletes only the selected record. Inactive records remain intact.
For a noncanonical selection, the selector remains unchanged after sign-out:
the missing selected slot fails explicitly, never falls back to canonical.
In a managed-only profile with complete route/Session evidence and no admitted
activity, Models still permits an explicit CAS switch to a stored valid account
or Add into a new inactive slot. The missing-slot view remains an error even
when `switchable` is true for that recovery. Existing Sign in never recreates
the missing slot with an unverified replacement identity; use Add then Switch.

## Presentation and quota

Models shows current identity and available accounts, Add, Switch and explicit
authorization recovery. Switch confirmation describes profile-wide impact and
history/replay risks. Activity and route blockers remain visible.

![Models account controls at a mobile viewport](./images/copilot-accounts.png)

![Read-only identity in Credits details](./images/copilot-accounts-credits.png)

These images render the actual candidate components with synthetic accounts
and quota in an isolated browser. They are not real authorization, supplier
availability or loaded Desktop evidence.

The separate `githubCopilotAccounts` namespace exposes `get`,
`refreshIdentity`, `add`, `cancel`, `switchAccount`, `reauthorize` and
`removeAccount`. Existing Remote descriptors are retained. The removal method
cannot be named `remove`: official rc.2 reserves that inherited service name
and rejects the entire Client contribution.

Credits shows the Session's next-turn account and quota under the existing title.
Its **Switch account** disclosure lists saved authorizations and **Follow global
default**. No Add, reauthorization or sign-out action appears in Chat. Changing
the preference while a turn runs leaves that turn's old account pinned; the
popover identifies it separately. Other Sessions are unchanged. Unknown identity
is unavailable, not a stale username presented as current.

Completed managed turns have a compact **Account** disclosure alongside native
Usage/selection actions through the public assistant-actions slot. This is
request-account evidence, not billing attribution or a subagent account rollup.
It captures an optional cached identity on the first real ordinary native chunk,
not discovery, preparation or auxiliary Auto assessment. Host memory retains at
most 64 Sessions and 128 turns per Session. Restart, cold history, eviction or a
request with no native delivery is unknown. Failed reads are distinct from
unknown evidence; Retry rereads the same turn without inference. Official rc.2
has no ignorable account-history event seam: no new durable event is emitted.

Identity and quota have separate error states but must share account evidence.
Models account mutations invalidate mounted Credits presentation before the
request and reject late responses. A data-free plugin-owned notification causes
a fresh read after settlement; it does not cancel native work or broadcast
identity, grants or quota between surfaces. Failed reads never restore the
previous username as current.
Missing quota is not zero; pooled, stale, request-based and credit-based
snapshots retain their distinct meanings. Do not claim cross-app aggregation
or relabel request counts as AI credits. No new periodic account network poll
or inference is introduced.

## Acceptance gates

- Native public authorization and credentials services: independent writes,
  cancellation, restart persistence, per-record serialization and strict grant
  JSON. No changes to the official fixture implementation.
- Both public gateways and strict Client codecs: no credential fields, stable
  descriptor identities, bounded arguments and visible errors.
- Exact published native adapter: correct account auth on all supported
  protocols; account-local refresh and failure; no ambient fallback.
- Races: A refresh versus B selection, admission versus switch, external record
  replacement, settings conflicts, disposal and late identity/quota responses.
- Behavior: absent-selector compatibility, missing-selector fail-closed,
  duplicate identity, same-account renewal, canonical route blocker, selected
  model missing, revoked permissions and account-bound replay.
- UI: Models global-default management, Session switching only inside Credits,
  global inheritance/explicit same-value override, frozen running turns,
  historical Account/unknown/read-error distinctions, dark/light/mobile,
  keyboard interaction, loading/error states and no overlapping controllers.
- No native Usage filtering, history edits, default selection changes or
  automatic model/account substitution.
- Full current rc.2 Windows/Linux CI, package and tarball gates, reviewed merge,
  immutable GitHub Release and same-byte npm publication before claiming
  delivery. Installation and restart need separate authorization.

## Current evidence and limits

Focused native adapter and gateway tests use unchanged rc.2 public APIs and
synthetic credentials/HTTP. They exercise Responses, Chat Completions and
Anthropic account dispatch, immutable refresh bindings, strict gateway
reachability, target CAS, admission and same-identity renewal.

The temporary-profile persistence fixture uses native `LocalCredentialProvider`,
profile boot/Loader, ConfigEditor, SettingsForms CAS, authorization and SDK.
Independent grants and the selector survive disposal/reopen; stale CAS does
not replace the config fiber; account A refresh never writes B. It injects
model preflight, and mocks identity/provider
HTTP. It is not full production lifecycle or live OAuth qualification.

The local frozen install and full gate are blocked by HTTP 404s for unchanged
official rc.2 dependencies from the configured enterprise mirror. No package
versions, registry policy or Core artifacts were substituted. The complete
required Windows/Linux CI matrix remains the release gate; focused tests,
synthetic UI and persistence do not replace it or prove live model success.
