# Changelog

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
