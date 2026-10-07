# Native Auto reviewer sampling compatibility

The plugin automatically omits `temperature` only from the official DSH
`0.2.0-rc.2` Auto reviewer root's account-proven managed `openai-responses`
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

Canonical Core-owned Copilot, other providers/protocols, aliases, descendants,
impostor callbacks and unresolved identity remain native. Unqualified reviewer
identity reports bounded fixed-code Host diagnostics, not a broad omission
fallback. Missing optional reviewer packages do not prevent ordinary startup.
Future official versions need qualification; the exact rc.2 check is intentional.

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
