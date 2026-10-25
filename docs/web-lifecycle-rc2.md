# DSH 0.2.1-rc.3 Web lifecycle characterization

This keeps the existing rc.2 documentation path for link stability, but updates its contents to the repository's current supported Core, DSH `0.2.1-rc.3`. It exercises the exact published Loader/Web packages and plugin bundle through public APIs. The synthetic fixture makes no network calls and removes its temporary files and Loader fibers. It does not exercise the native Desktop package manager or claim the observed account-status incident was caused by any one internal transition. Earlier rc.2 findings are historical; the rc.3 test results below are authoritative for the current plugin line.

## Desktop guidance

The Web search card uses the version-neutral heading **Desktop plugin lifecycle**. This is general guidance: it does not detect the installed Desktop version or whether a restart is required.

If the native plugin manager explicitly reports `restart-required` after a plugin change, fully exit Desktop (including its tray/background process) and launch it again. This is not a blanket instruction to restart after every disable, removal or upgrade, and it does not promise that a restart fixes every activation error.

If the plugin is already **Off** and the manager shows only pending entries waiting for a service, do not repeatedly toggle it as a recovery attempt. The rc.2 disable observation below is historical context, not a diagnosis of the current host; the rc.3 synthetic transitions are separately scoped evidence. Other activation errors and mixed diagnostics require their own investigation.

## Reproduce

From the repository root, after the normal build:

```powershell
pnpm build
node --test tests/scripts/web-lifecycle-characterization.test.mjs
```

The test checks that `package.json` pins `@deepseek-ai/dsh-app-boot` and `@deepseek-ai/dsh-web` to the currently supported DSH version and uses the pinned public `cordis-plugin-loader`. It loads the built plugin-owned delegate and router through the public Loader, and creates temporary synthetic search/fetch providers and an independent consumer. It makes no network calls.

## Observed transitions

The no-overlay control confirms the stock global `ctx.web`, registered synthetic search/fetch providers, and an independent global consumer can use both APIs. A **single-step** hot add of the exact bundle rows also preserves the global service and both active consumers in this fixture. That passing transition narrows the earlier rc.2 finding: it does not establish that every add sequence is safe.

For a **staged** first-add, immediately before the bundle is applied, global `ctx.web`, provider search and the independent consumer are active. Reconciliation is then split across three public Loader updates using the exact bundle IDs, enabling the Web delegate and routed rows in turn. The global service becomes unavailable and the consumer becomes pending; the registered provider remains callable through its captured official `WebRuntime`. This is not evidence that a single-step add or cold load fails.

For **remove/re-add**, the complete Web-routing rows are loaded at boot and the global service plus independent consumer are verified usable before removal. Removal leaves `ctx.web` unavailable and the consumer pending, although the captured official runtime still serves the synthetic provider. Re-adding the exact rows does not restore the global service. Calling the public `ctx.reflect.notify(['web'])` after re-add also does not recreate it; the consumer remains pending. This is a minimal public-Loader reproduction of the preventable hot-readd failure.

The lifecycle test does not call Core internals or mutate a live profile. The plugin's account integration is nested behind `ctx.inject()` for `web` in `src/index.ts`, so an unavailable global Web service can also keep dependent Host account services from activating. This links the reproduced service lifecycle failure to an account-controls availability risk; it does not prove that this was the sole cause of issue #371.

These synthetic observations do not reproduce or override the native Desktop manager's package-update contract. In the exact official rc.3 `dsh-plugin-manager` tests, an in-place upgrade without HMR returns `restart-required` and keeps the currently running version active; see [`package-reload.spec.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/boot/plugin-manager/tests/package-reload.spec.ts). A plugin cannot truthfully promise seamless application of that update. Honor an explicit manager restart requirement. This is separate from a hot remove/re-add transition for which the manager allows runtime reconciliation.

## Historical rc.2 Desktop disable observation

The prior rc.2 Desktop investigation observed disable complete with the plugin shown as **Off**, then report only:

```text
web-search-deepseek: pending (waiting for service: web)
web-fetch-http: pending (waiting for service: web)
```

This native observation predates the current rc.3 package qualification and is not a claim about current Desktop behavior. The plugin cannot change or reclassify that native result after disable because its Client contribution has already been unloaded. Do not treat this historical warning as proof that every disable/remove requires restart, or convert other activation errors, mutation failures, or mixed diagnostics into success.

The tests named `known-bug characterization` intentionally pass when the rc.3 fixtures continue to exhibit the documented staged-add and remove/re-add states. They are evidence of a known limitation, not acceptance of the broken transitions.

## Bounded public-API finding

In the exact published rc.3 `WebRuntime` declarations, public search/fetch APIs are provider registration plus `search()` and `fetch()`. Provider maps remain private. Although provider-selection configuration is volatile and read at each request, there is no public middleware/interceptor after provider selection, selected-provider lookup/dispatch operation, or service replacement/rebinding contract for active consumers.

The public-API test checks additive registration: a configured existing provider continues to win over an added routing provider, while two usable providers without a configured ID produce `WEB_PROVIDER_AMBIGUOUS`. Additive registration therefore cannot transparently preserve configured-provider selection and the plugin's exact primary/fallback dispatch. A second global `web` service collides with the existing service name; moving the official service to a child scope is the current composition that exposes the consumer lifecycle problem. Cordis `reflect.notify()` refreshes dependents but cannot recreate a missing global service, as the rc.3 re-add fixture demonstrates.

The plugin-only fix requires one of these official public capabilities: (1) disposable search-dispatch middleware on the existing `WebRuntime`, invoked after normal provider selection with `(request, signal, next)` so eligible Copilot calls can route while all other requests delegate unchanged; or (2) a Loader-owned service-replacement/recomposition operation that restores the service and rebinds dependents when isolation changes. The Web hook must preserve cancellation, result caps, configured-provider semantics and registration ownership. Neither contract is present in the pinned rc.3 API.

Without one of these APIs, a plugin workaround would either leave `ctx.web`/existing consumers stranded or change Web provider selection and routing behavior. A public notification alone is insufficient. No runtime workaround is made, and issue #371 remains open.

TLS trust configuration, including request-scoped CA handling for quota reads, does not affect Loader/Web service lifecycle and is not a remedy for this issue.
