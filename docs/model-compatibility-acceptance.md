# Copilot compatibility acceptance

This change is not complete when a GPT-6-only prototype works or a PR is merely opened. The requested result is a plugin-only, data-driven Copilot integration, including public reasoning summaries, followed by verified delivery and local upgrade.

## Scope

Follow the [plugin-only boundary](../AGENTS.md#plugin-only-implementation-boundary). Reuse the published DSH/pi-ai adapter and OAuth interfaces. Do not modify Core, dependency artifacts, private registries, or shared upstream catalogs. A plugin-owned Copilot route may serve multiple account-advertised models; this is configuration and lifecycle integration, not another implementation of generic wire serialization.

## Required behavior

1. **Account-driven discovery.** Read the provider's model metadata with bounded requests and account-scoped cache lifetime. A new model with sufficient supported metadata must not require another model-ID patch or plugin release. A new model name alone is insufficient evidence of its protocol or capabilities.
2. **Protocol selection from evidence.** Use advertised `supported_endpoints` for Responses, Chat Completions, or Anthropic Messages. Native pi catalog choices may be retained only when compatible with the advertised endpoints. Do not infer a protocol from a GPT, Gemini, Claude, or other name prefix. Missing or unsupported metadata produces an explicit diagnostic, not a guessed route.
3. **Capabilities stay distinct.** Preserve context, input and output limits separately; do not invent large limits or unsupported reasoning levels. Respect disabled/unconfigured policy, picker eligibility and tool/stream support. Provider metadata does not authorize changing account policy.
4. **One credential lifecycle.** All plugin-owned routes share the canonical Host-only Copilot OAuth record. Model discovery, refresh and in-flight requests remain bound to the same account generation. Account switches, entitlement removal, disposal and stale callbacks must fail closed without copying credentials or changing other providers.
5. **Thinking is included.** Preserve public summary deltas and final-only summaries without duplicate text. Validate selected effort and keep native default semantics. Empty or encrypted-only responses must not become fabricated explanations. Native replay, images and file projection retain their owning adapter's behavior; opaque replay is not displayed or rewritten into raw reasoning text.
6. **pi 0.85.1 compatibility.** Pin and test the requested published SDK version, not just a GitHub release label. Its Copilot GPT-6 catalog protocol must not override contrary provider endpoint evidence. An updated catalog entry is not sufficient grounds to retire a correction if the protocol/capabilities are still wrong.

## Regression evidence

- Include GPT-6 Astra, Gemini 3.8 Flash and GPT-5.6 Sol Fast metadata fixtures, plus arbitrary unseen IDs on all three supported protocols. The unseen-ID cases must pass without adding those IDs to implementation tables.
- Cover missing/conflicting endpoints, missing/invalid limits, duplicate conflicting IDs, explicit denial, stale account snapshots, unsupported reasoning labels, unknown fields and hostile extra getters.
- Exercise real published adapter/SDK code against local synthetic HTTP for all supported protocols, including tools, public summaries, two-turn opaque replay, images and interruption/retry paths. Synthetic results are not claims of live account availability.
- Run source/test typechecks, complete repository tests, built Host/Client/Remote smoke, archive verification, and relevant unchanged-Core compatibility fixtures. Do not suppress type or test failures to bridge incompatible SDK versions.

## Explicit public-interface limits

- The published Core model-info contract exposes combined context capacity, not a separate prompt-token budget. The plugin preserves the provider's input limit but cannot claim Core automatically enforces it. When that input limit is smaller than the combined context, the discovered model must show `INPUT_LIMIT_NOT_ENFORCED_BY_CORE`; server rejection remains possible. Do not silently replace combined context capacity with an invented input budget or add a Core patch.
- Advertised reasoning labels that the native SDK cannot express must show `REASONING_EFFORTS_UNSUPPORTED` rather than being silently hidden or guessed. Such a warning need not disable ordinary model requests.
- The Core-facing adapter integration uses the public `streamSimple` path. Its advanced protocol-specific `stream` entry must reject explicitly rather than accepting incompatible client objects from another SDK version. The event-stream compatibility boundary must verify the full public surface at compile time and preserve the original stream object.
- Cached catalog entries do not authorize requests independently. A change in the current grant's model-permission list invalidates old proofs even when the token and account identity are unchanged; a new server-enabled model absent from the earlier grant list remains discoverable without rewriting the grant.

## Delivery and local acceptance

- Open the plugin PR with tests, evidence limits, migrations and rollback. Merge only after required checks and review are satisfied; the user has explicitly included merge in this task's acceptance scope.
- Publish the aligned version through the protected Release workflow and verify the release/tag/commit/assets/checksum.
- Upgrade the user's actual local profile to that verified plugin artifact; do not infer the profile from a README example. Verify installed bytes and loaded runtime separately.
- The user has requested local upgrade. Explain any session-interrupting restart before doing it and obtain acknowledgement of that interruption. Do not install a modified Core as part of the upgrade.
- Report remaining limitations honestly, including unavailable provider metadata, unsupported protocols, optional summaries and any unperformed live checks.

## Metadata references

- [Microsoft Copilot API types](https://github.com/microsoft/vscode/blob/main/src/typings/copilot-api.d.ts)
- [Endpoint-driven Copilot discovery implementation reference](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/plugin/github-copilot/models.ts)
- [pi v0.85.1 release](https://github.com/earendil-works/pi/releases/tag/v0.85.1)

These references guide parsing and tests; they are not a guarantee that the upstream discovery schema will never change. Schema drift must be surfaced rather than silently guessed.
