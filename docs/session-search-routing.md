# Per-session web search (issue #112, implementation in progress)

## Requested behavior

The initiating Session chooses the route, not the global default model. Canonical Copilot and verified plugin-owned `github-copilot-preview` selections prefer Copilot hosted search. DeepSeek and all other providers continue through the existing official web service unchanged. The user permits automatic DeepSeek fallback without per-query confirmation; each fallback must identify the actual backend, reason and possible DeepSeek API charges. A configuration switch must allow fallback to be disabled. Cancellation, owner disposal and invalidated account proof never authorize a fallback request.

All implementation belongs to this plugin. No Core source, deployed Core artifact, prototype, private registry, credential copy, global model choice or existing search provider selection is modified.

## Implemented foundation

`src/search-routing.ts` routes one already-validated search using captured provider/model leaves, a verified managed-route ownership flag and operation-local dependencies. It delegates non-Copilot requests without touching Copilot availability, discovery or fallback. The fallback accepts only an explicitly supplied `deepseek-official` provider instance. It never guesses the backend of `next()` or another global dispatcher. It retains cancellation and account-generation checks across asynchronous work. Successful empty results do not trigger fallback.

Fallback notices are part of `WebSearchResult.content`, not only a Tool result's outer `content` or `meta`: Core's successful-result normalization can regenerate those outer fields from the canonical value. The notice must survive the official consumer's formatter and web result card. This still needs a real-consumer integration test.

`tests/search-routing.spec.ts` covers route preservation, owned preview selection, explicit fallback policy, cause/cost disclosure, cancellation, proof invalidation, unknown fallback providers and simultaneous operations. These are synthetic unit tests; they do not prove live search, loaded plugin behavior or the ordinary `web_search` integration.

## Public API findings

- Inspected Core rc.1/rc.2 WebRuntime exposes registration, search and fetch. Selected provider identity and provider maps are private; there is no public per-request provider override.
- A `tools/execute` short circuit is possible but skips body argument checks and downstream middleware. Name or schema equality does not prove a tool is official; `defineTool` wraps public presentation callbacks, so callback identity is not a reliable substitute.
- The official `@deepseek-ai/dsh-tool-web` exports `applyWebSearchTool`. Its consumer owns validation, query deduplication, parallel cancellation/drain, source caps, formatting and presentation. These should remain in the actual executed tool body.
- The public `DeepSeekSearchProvider` class exists in published `@deepseek-ai/dsh-web-search-deepseek` releases, including the retained development baseline. A plugin-owned instance can be a known fallback without copying the provider transport or reading Core private provider maps. Reuse the public credential resolution and configured provider options; no copied secret store.

## Integration to verify next

Prefer an explicit bundle-owned `web` isolate for the existing official `tool-web` consumer, preserving the row's existing config and other service dependencies. A plugin-owned WebRuntime adapter in that realm forwards non-Copilot search and fetch to the captured original Host web service. A root plugin service captures the original service before the isolated adapter is created and supplies the existing Copilot plan plus a known official DeepSeek fallback instance. This is a proposed composition, not yet implemented or validated.

Required checks before shipping:

1. Overlay isolation preserves the existing official consumer's id/config and all permissions, timeout and query/source caps. No duplicate tool registration or blanket scoped shadow.
2. The isolated adapter and root routing service have reversible registrations; unloading and reloading leave no stale service or late request.
3. The root service captures the actual initiating Agent and provider/model before awaiting discovery, then carries that owner/proof through all queries and fallback. No global-default substitution.
4. The fallback uses the supplied official DeepSeek instance, respects credentials/settings, does not loop through the router, and emits a clear result notice without per-query approval.
5. Real official consumer tests cover successful Copilot results, explicit fallback and failure, card/replay normalization, cancellation, strict caps, multiple queries and unchanged other-provider errors/results.
6. Retained Core source/artifact baselines are tested at their exact pins. Update package metadata/exports, baseline evidence and release metadata only after the integration exists.
7. Run bounded live hosted-search acceptance separately; a successful LLM chat test does not prove hosted search. No live profile installation or restart has occurred for this work.
