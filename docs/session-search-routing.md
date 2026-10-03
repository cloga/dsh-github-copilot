# Provider-aware Web search

Target: official DSH / Windows Desktop `0.2.0-rc.2`. The routed facade and
configuration page are shipped plugin functionality, not a pending proposal.

## Choose who searches

Open **Plugins → dsh-github-copilot → Details → Web search**.

| Control | Behavior |
|---|---|
| Search provider: Auto | Follow the initiating Chat provider when its exact supported search registration exists |
| Search provider: an ID | Always use that registered provider, independent of later Chat model changes |
| Fallback provider | At most one different final provider after an eligible failure; None disables it |

Saving both routing leaves uses one native settings CAS, with no Copilot
credential, model discovery or capability-probe prerequisite. Saving does not
prove a provider is available. The directory lists fresh public registrations,
not static examples; unavailable stored IDs stay visible and fail explicitly.
Reload sees newly registered IDs.

![Actual parent-following and search controls with synthetic settings](images/copilot-search-routing.png)

The picture uses actual published Client components in an isolated browser.
It does not demonstrate a live search or loaded Desktop runtime.

## Routing and fallback

Auto uses the captured initiating Session/request route, never the global Chat
default or another Session. Copilot aliases keep their account/model checks;
other IDs match an observed search registration exactly. Model names/families
do not become search providers. This provider-level convention does not promise
the same account or execution model across independent registries.

A successful primary result, including zero sources, ends routing. Failure may
try one distinct final fallback, never the same backend twice, a hidden third
tier or recursive routing. Cancellation, disposal, registration replacement
and account-proof invalidation terminate the operation. Captured implementations,
not only replaceable IDs, remain bound to the request.

Fallback notices survive native result projection in `WebSearchResult.content`,
identify the backend and possible charges, and expose no raw exception.
Generic providers own their authentication and cancellation; their endpoint/model
provenance is not guessed from Chat. The stronger Copilot/legacy pre-dispatch
proof guard is not claimed for every third-party implementation.

## Copilot model selection and proof

Auto-following Copilot search uses the initiating real model. Explicit/fallback
Copilot search instead preserves a nonempty `github-copilot.searchModel`
override; otherwise it non-forcing ensures current account metadata and
considers at most three eligible Responses models in deterministic ID order.
No model-name table, Session borrowing or global default supplies candidates.

Metadata establishes eligibility, not search capability. Default `probe: true`
requires bounded successful proof before **one final user-query request**.
Candidate proof is not query replay; a final failure never tries the query on
another model. `probe: false` is an explicit trust override, not a recommended
repair. Cancellation or captured credential/account-proof changes fail closed.
Successful reusable proofs retain account/owner lifetime, not the creating
request's signal/deadline. Concurrent callers own their unfinished probes.

## Settings and legacy compatibility

Routing lives in `github-copilot.searchRouting`. One CAS writes nested paths
`['searchRouting', 'searchProvider']` and
`['searchRouting', 'defaultSearchProvider']`. Legacy separate namespaces are
read-only fallback sources. Old fixed/none spending restrictions are preserved
until an explicit save adopts new policy; unknown IDs never silently normalize
to an available provider.

A nonempty legacy `searchModel` is displayed read-only and remains authoritative.
Only its separate reset writes `searchModel: ''`. Both actions coordinate the
shared namespace revision without discarding unsaved drafts. A failed reset
does not block an unrelated routing save.

Official SettingsForms projects volatile Config leaves; the plugin uses native
live fields and narrow writes, not a manually invented namespace registration.
Traced Settings/routing Remote faces are captured once at UI registration so
parent renders retain drafts and pending saves. `routeWebSearch`, enable,
allowlists and capability proof keep independent responsibilities. Safety and
transport settings are not routine fields on this card.

## Composition and installation safety

The plugin moves the original enabled top-level official Web service into
`github-copilot-original-web`, exposes it through a public Fiber-owned delegate,
and mounts its routed facade in ordinary Host Web scope. Original configuration,
fetch and native tool consumers remain under their owners. A separate private
official WebRuntime retains request validation/source capping for routed search.
No preset edits, private registry access or Core prototype replacement occurs.

Before install/update, run the verified package's read-only
`scripts/check-search-composition.mjs` with profile, home, install anchor and
all launcher patches. Require `supported: true`. It parses public composition
without booting plugins, credentials, network or settings writes and compares
the baseline with the actual candidate bundle position.

Custom/dynamic/nested/disabled/already-isolated layouts, collisions and a nonempty
disposable `cordis.yml` root are refused. Normal `composeProfile()` rewrites that
root to `[]`, so preserve it and review complete reconstructibility before any
separately approved normalization. `dsh plugin add` does not enforce preflight.
Do not describe unsupported composition as a safe no-op.

Desktop supports its qualified bundled CLI, not any generic shim.
[Installation guidance](./npm-distribution.md#desktop-bundled-cli-on-official-rc2).
Web service disable/remove/upgrade may require a cold restart; do not use
remove/re-add as a hot-upgrade workaround.
[Lifecycle characterization](./web-lifecycle-rc2.md).

## Verification and limits

Real Loader/ConfigEditor/SettingsForms fixtures cover volatile discovery,
two-leaf CAS, same Fiber, stale conflicts, hidden legacy reset and restart
persistence. Client gateway/actual registration tests cover traced identities,
draft continuity and catalog reads; a settings-map mock alone cannot establish
native reachability. Native WebRuntime/Agent/tool fixtures cover validation,
registration disposal, result notices and original fetch ownership.

Policy and transport tests cover bounded candidates, lazy account discovery,
proof expiry, fallback auth, credential discontinuity, cancellation and
independent requests. Published Client desktop/narrow captures use synthetic
services. Required exact rc.2 Windows/Linux CI remains the release gate; counts
and old local registry failures belong in the relevant PR evidence, not permanent
setup instructions.

Live hosted-search capability, paid fallback behavior and Desktop activation
require separate authorized acceptance. Ordinary Chat success, saved routing,
synthetic tests or a source marker prove none of those layers.
Design history: [#135](https://github.com/cloga/dsh-github-copilot/issues/135),
[#148](https://github.com/cloga/dsh-github-copilot/issues/148),
[#195](https://github.com/cloga/dsh-github-copilot/issues/195) and
[#216](https://github.com/cloga/dsh-github-copilot/issues/216).
