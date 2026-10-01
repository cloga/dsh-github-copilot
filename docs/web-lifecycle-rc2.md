# DSH 0.2.0-rc.2 Web lifecycle characterization

This is a bounded characterization of the public Loader and Web APIs in the pinned DSH 0.2.0-rc.2 packages. It records a known limitation; it is not a passing acceptance test for desired add/remove/re-add behavior and does not exercise the native Desktop package manager.

## Reproduce

From the repository root, after the normal build:

```powershell
pnpm build
node --test tests/scripts/web-lifecycle-characterization.test.mjs
```

The test uses the installed `@deepseek-ai/dsh-app-boot` and `@deepseek-ai/dsh-web` packages, loads the built plugin-owned delegate and router through the public Loader, and creates temporary synthetic provider/consumer modules. It makes no network calls and removes its temporary directory and Loader fibers in `finally`.

## Observed transitions

The test first checks an unaffected no-overlay control: the stock global `ctx.web`, a registered synthetic search provider, and an independent global consumer are active, and a search returns the provider's marker result.

For the exact-bundle first-add sequence, it records the activation ordering explicitly. Immediately before the bundle is applied, global `ctx.web`, provider search, and the independent consumer are all active. During staged Loader reconciliation using the bundle's real Web/delegate/router IDs, global `ctx.web` becomes unavailable and the consumer becomes pending. The registered provider remains callable through the captured official WebRuntime, but adding the delegate and routed rows does not restore global `ctx.web` or the consumer in this fixture. This is not evidence that all cold starts fail: the separate cold-load fixture below succeeds.

For the separate remove/re-add sequence, the complete Web-routing rows are loaded at boot, then global `ctx.web`, provider search, and the consumer are verified usable before removal. Removal leaves global `ctx.web` unavailable and the consumer pending, while the captured official WebRuntime still answers through the registered synthetic provider. Before re-add, the test asserts and reports this stranded state rather than claiming an active-consumer precondition: removal has already invalidated it. Re-adding the exact candidate rows and retrying reconciliation do not restore global `ctx.web` or consumer activation in this fixture.

These are isolated public Loader observations using synthetic plugins. The older untracked reproduction used temporary IDs `delegate` and `routed` and no active provider; it reported that the staged route became usable after the final reconcile. The tracked fixture now uses the exact IDs from `cordis.patch.yml`, tests an active provider for the add/remove scenarios, and separates staged hot-add from a complete cold-loaded route. This accounts for the differing observations; the older alias-ID result is not evidence that the exact bundle hot-add succeeds.

The fixture does not exercise the native Desktop package manager, installation behavior, recovery after process restart, or every profile composition. The native manager's `restart-required` result for upgrading an installed package in place is a separate package-update boundary and is not evidence that the hot route lifecycle is repaired.

The test names begin `known-bug characterization` intentionally. They pass only when the pinned rc.2 fixtures continue to exhibit the documented states. A desired recovery acceptance test must instead prove that the consumer and provider stay usable through each supported transition, global `ctx.web` remains available, official/delegate/routed paths remain correctly owned, and teardown removes only the registrations owned by their fibers. Do not reinterpret this characterization test as approval of the current behavior.

## Bounded public-API finding

In the exact published rc.2 `WebRuntime` declarations, public search/fetch APIs are provider registration plus `search()` and `fetch()`. Provider maps and configured provider IDs are private. There is no public middleware/interceptor, selected-provider lookup or dispatch operation, or service replacement/rebinding contract for active consumers.

The included public-API test also checks additive registration directly: a configured existing provider continues to win over an added routing provider, while two usable providers without a configured ID produce `WEB_PROVIDER_AMBIGUOUS`. It therefore cannot transparently preserve configured-provider selection and the plugin's exact primary/fallback dispatch. A second global `web` service collides with the existing service name; moving the official service to a child scope is the current composition that exposes the consumer lifecycle problem. Cordis effects own this plugin's own registrations but do not rebind other active fibers when a service's scope changes.

The specific extension needed for a feature-equivalent plugin route is a public, disposable search-dispatch middleware on the existing `WebRuntime`, invoked after normal provider selection and receiving `(request, signal, next)` so it can route eligible Copilot calls while delegating all other calls to the already-selected provider. It must preserve cancellation, result caps, configured-provider semantics, registration ownership, and unrelated consumers. A Loader-owned alternative would be an explicit public service-replacement operation that rebinds dependents when service isolation changes. Neither contract is present in the pinned rc.2 API examined here.

This finding is limited to those inspected APIs and the requirement to preserve current routing behavior for active global consumers; it is not a claim that all possible future APIs or behavior-changing opt-ins are impossible. An independent plugin-owned Web provider/configuration path would require user configuration and would alter existing selection/fallback behavior, so this task does not present it as a transparent repair.

## TLS system trust is a separate, unverified operational option

The signed rc.2 Desktop main process starts the Host as a separate Node-mode child and passes inherited environment settings to it. The documented Node option `NODE_USE_SYSTEM_CA=1` keeps certificate validation enabled while adding the operating-system CA store to Node's trust sources. This changes which trusted roots Node accepts; it is not a Desktop setting and does not configure Chromium's separate trust behavior. Earlier no-credential HEAD diagnostics reached an HTTP response with system CA enabled where the signed Node runtime's default trust failed certificate verification. This does not prove the cause of the prior OAuth failure or that authentication will work.

If an operator later chooses this diagnostic option, use only a user-owned, reversible launcher that sets the variable for a fresh Desktop launch. First fully quit the existing Desktop so a new invocation cannot be handed off to an already-running single instance; then launch the signed executable as the new main process. Do not set a machine/user-global environment variable, edit the installed shortcut or Desktop profile, bypass TLS checks, or install roots. Keep the launcher process and any redirected standard I/O handles alive for the full Desktop process lifetime; do not pipe them through a short-lived shell, which can close the stream and produce `EPIPE`. Removing the user-owned launcher reverses this opt-in. This is a recommendation only: no launcher was created or run, no live Desktop state was changed, and no sign-in retry was performed.
