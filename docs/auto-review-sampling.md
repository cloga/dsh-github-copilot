# Native Auto reviewer sampling compatibility

## Canonical native route (DSH 0.2.2-rc.5)

The same reviewer-only policy also covers `github-copilot` when the public
Loader root, native adapter package callback, configurable-provider directory,
settings revision and the adapter-owned public pi-ai 1.3.0 catalog prove a
native Responses route. The adapter and plugin may resolve separate pi-ai copies;
protocol facts come from the adapter's copy, not an assumed equivalent plugin
catalog. Missing exports or incomplete metadata leave the enhancement
unavailable with a diagnostic. It requires `purpose: 'auto-review'` and excludes
loop-owned requests. Custom credential, endpoint and unqualified compatibility
overrides remain native; unknown models are diagnosed, never assigned a guessed protocol.

Qualification reads the native Settings schema output, not raw YAML (#483).
The schema materializes empty `compat.chatTemplateKwargs` and
`compat.chatTemplateArgs` maps at provider and model levels. These empty maps
are not custom transport. The only additionally qualified compatibility leaf
is boolean `supportsStrictMode`, which controls native tool-schema strictness,
not credentials, endpoint, protocol or sampling. Apply the same narrow rule to
provider, configured model and model-override entries without mutating any of
them. Nonempty template maps, unknown compatibility keys and malformed values
remain unqualified; credential, endpoint, headers, ownership and lifecycle
checks are unchanged.

Deleting `compat` from stored configuration is not a workaround: schema
normalization recreates its empty defaults. The regression must pass real native
Config/Settings output through reviewer and hosted-search qualification; raw
handwritten profile fixtures alone cannot establish this compatibility.

The auxiliary request is cloned without temperature and prepared through public
`llm.prepareCall`. Identity and configuration are checked again after awaits,
and the prepared generation is dispatched once. Preparation failures, cancellation
and revocation never trigger a fallback or resend. The canonical fixture uses
the actual native pi-ai adapter and reviewer/tool pipeline with synthetic HTTP
responses for allow, deny, malformed verdict, HTTP error and cancellation.
Disposing the enhancement reproduces the unsupported-temperature failure.
These are synthetic acceptance requirements, not proof of live supplier access.

### Historical native configuration limitation

[#483](https://github.com/cloga/dsh-github-copilot/issues/483) reports that
plugin releases through alpha.12 could reject DSH's schema-default empty maps,
leaving both reviewer temperature omission and canonical hosted search
unavailable. The alpha.13 release includes the narrow qualification fix from
[#485](https://github.com/cloga/dsh-github-copilot/pull/485); its source CI
and publication do not prove live runtime behavior. The report observed
unsupported-temperature errors on alpha.8, not on every configuration.

## Managed-route compatibility

The plugin automatically omits `temperature` only from a supported official DSH
Auto reviewer root's account-proven managed `openai-responses`
requests. No user opt-in is required. Concurrent ordinary Chat, even on the same
Session/model, retains its requested sampling. No supplier capability is inferred
from `supports.thinking`; the policy addresses the reported unsupported-temperature
reviewer rejection, not a claim about all supplier models.

## Public ownership proof

At official commit `639ed015397290b3745d163aafe02ffee4aa3f84`:

- `vendor/cordis/src/events.ts:344-345` documents the exported `internal/get`
  service-read waterfall, including the calling Context.
- `vendor/cordis/src/fiber.ts:9-13` exports `Context.fiber`;
  `vendor/cordis/src/registry.ts:135-142` documents the public runtime callback as
  executable identity.
- `vendor/loader/src/index.ts:52-54` exports `Fiber.entry`;
  `vendor/loader/src/config/entry.ts:46-50,221-234` exposes the entry's root fiber
  and imports the configured plugin; `config/tree.ts:10,112-124` exposes its
  resolution context and importer.
- `packages/boot/app-boot/src/profile-resolution/service.ts:17-35,90-105`
  publishes profile-aware `PluginPackages.packageOf` package ownership.

The plugin requires exact entry-root equality, the official package/version,
matching manifest ownership in the Loader tree and plugin import contexts, and
independently imported public `apply` equality with the caller's runtime callback.
The loader's returned fiber can be a thenable wrapper; root ownership compares
its public `ctx.fiber` with the caller's fiber, not the wrapper object.
It rechecks root/liveness after asynchronous resolution. Names alone are not
identity. Importing the public module does not apply/register another reviewer.

A reversible plugin-owned facade delegates every exposed service property except
scoped `stream` unchanged. For a proven managed Responses route, it clones the
frozen caller options and omits temperature before native normalization/dispatch.
There is no source-option WeakSet, prompt/error/model-name matching, shared
prototype mutation, new wire, retry, verdict rewrite or permission change.
Native account/initiator routing and cancellation remain owners of request access.
Plugin disposal revokes its listener and in-flight scoped dispatch.

## Scope and evidence limits

Unqualified canonical Copilot, other providers/protocols, aliases, descendants,
impostor callbacks and unresolved identity remain native. Unqualified reviewer
identity reports bounded fixed-code Host diagnostics, not a broad omission
fallback. Missing optional reviewer packages do not prevent ordinary startup.
The `0.2.2-rc.5` candidate remains subject to its exact-source and
published-artifact qualification; future versions also require qualification.

The independent legacy `responsesOmitTemperature` setting remains default false.
Explicit true still changes **all** managed Responses sampling; it is not needed
for this automatic reviewer-only policy and is not silently enabled or migrated.

The fixture uses the unchanged native reviewer, LLM normalization and adapter with
synthetic credentials/metadata/HTTP responses. Published artifacts exercise the
actual native Loader importer; tagged source uses the public-export TypeScript
fixture resolver. Both runners explicitly include the reviewer fixture and reject
missing, skipped or wrong-count suites. Canonical/other-provider negatives use
test-owned native adapter stubs, not live canonical transport. No qualification
claim proves live supplier acceptance, installed/loaded state or paid inference.
The earlier published `.fixture.ts` CLI filter was excluded by the ordinary
`.spec.ts` include; its execution claims remain retracted on issues #374/#378.
