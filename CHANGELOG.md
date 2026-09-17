# Changelog

## 0.4.0-alpha.24 (prepared)

- Declare the exact `remote.githubCopilotSearchRouting` dependency in the search UI child Fiber so the Web search card can render under Cordis service tracing (#137).
- Regress the actual Client apply/render callback with real Cordis traced services on both the Models footer and legacy section, including independent account activation and routing-service loss cleanup.
- Preserve all account, cancellation and paid-fallback guards. Isolated tests do not claim packaged Desktop activation or live search success.

## 0.4.0-alpha.23 (prepared)

- Fix Model roles loading by exposing the dedicated Host `view`, `save` and `create` methods through the public Typert Remote service, retaining strict validation, CAS and session-creation ownership (#134).
- Replace Copilot-specific Auto/fixed labels and static provider suggestions with a real registered search-provider catalog shared by the primary and final-fallback selectors (#135).
- Follow the initiating Chat provider in Auto mode, keep an explicitly selected primary independent of Chat, and attempt at most one distinct final fallback. Preserve legacy settings without automatic writes and keep model choices provider-owned.
- Capture registration and account continuity before asynchronous work; silently revoked Copilot proof, cancellation, unload or registration replacement cannot authorize a paid fallback.
- Add real Host Gateway, registration-lifecycle, provider-routing and UI regressions plus an isolated built-component browser fixture. Preserve alpha.21 shared-peer ownership and alpha.22 React Client external declarations; no Core or live-profile changes are included.

## 0.4.0-alpha.22 (prepared)

- Declare React as the DSH Client ModuleLoader external used by the actual built Client bundle, while removing it from the strict Desktop Node peer graph and retaining it only for development.
- Extend packed-manifest validation from Host shared-package intersection to every declared required peer and Client external, preserving required authorization/schemastery Host peers.
- Regress the actual packaged Desktop 0.1.5 startup failure `requires missing react@^18.2.0` without bundling a second React instance or weakening `autoInstallPeers: false` graph validation.

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
