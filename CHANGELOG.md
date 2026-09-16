# Changelog

## 0.4.0-alpha.21 (prepared)

- Move Desktop-owned `@deepseek-ai/dsh-authorization` and `@deepseek-ai/schemastery` from private runtime dependencies to required compatible peers while retaining development copies for standalone build and test verification.
- Audit every declared dependency and peer against the hash-pinned actual Desktop 0.1.5 runtime descriptor and generated Desktop 0.1.6 package-set input.
- Make packed-tarball verification reject bundled, optional, incompatible, or newly unaudited shared-package ownership without weakening Desktop validation or changing Copilot lifecycle, image-offload, Models, or authorization behavior.

## 0.4.0-alpha.20 (prepared)

- Add opt-in, bilingual **Model roles** settings with account-discovered planning and execution models, revision-checked save, and an explicit new-session entry.
- Capture the two roles only for dedicated new sessions; preserve existing conversations, global defaults, OAuth ownership and ordinary Subagent settings.
- Delegate implementation through native continuable executors with an exact route, scoped workflow controls, durable policy replay and explicit model-unavailable errors rather than fallback.
- Preserve create-request identity across uncertain results, and distinguish a confirmed not-created result from failed recovery of an existing session.
- Add real React DOM, actual Client Gateway, and Core Session/projection/tool primitive regressions, plus an isolated built-component browser fixture. These tests do not imply a live model call or production Desktop activation.

## 0.4.0-alpha.19

- Adapt the plugin compatibility contract to DSH `0.1.6-alpha.1` at
  `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`.
- Exercise awaited, serialized `agent/created` initialization before reading
  live Session state in the unchanged tagged-source fixture.
- Verify the 0.1.6 Session projection/history boundary, MCP v2 resource
  pagination, PTC runtime and `workflow-ptc` names, cancellable Sandbox/Shell
  preparation, optional-plugin startup policy, attachment cache separation,
  and Team task pagination without taking ownership of those Core services.
- Follow the 0.1.6 image-budget contract: preserve `IMAGE_OFFLOAD_REQUIRED`,
  apply the Core durable `image/offload` projection, and prove the retried
  Copilot request uses the mapped read-only normalized path without image bytes.
- Preserve provider-scoped Copilot tool-schema filtering and the existing
  immutable GitHub Release plus npm OIDC distribution design. This version is
  prepared for a Draft compatibility PR only; it is not published by this change.
