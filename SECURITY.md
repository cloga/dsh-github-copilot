# Security policy

## Supported versions

Security fixes are applied to the latest GitHub Release and the `main` branch. Older release tarballs remain available for reproducible deployments but do not receive backports unless a release note explicitly says otherwise.

## Report a vulnerability privately

Do not open a public issue for credential exposure, OAuth/session handling flaws, endpoint-validation bypasses, or another vulnerability that could put users at risk.

Use GitHub's private vulnerability reporting for this repository:

https://github.com/cloga/dsh-github-copilot/security/advisories/new

Include:

- the affected release or commit;
- the DSH baseline and operating system;
- a minimal reproduction or proof of concept;
- the expected and observed security boundary;
- whether credentials, tokens, logs, or release artifacts may have been exposed.

Never include a live GitHub, Copilot, npm, or DSH credential. Replace secrets with clearly synthetic values and redact raw provider responses.

## Security boundaries

This package keeps Copilot credential payloads on the Host, accepts only validated GitHub-hosted or signed-in Enterprise Copilot endpoints, and does not route credentials through an external gateway. DSH Core owns sandboxing and approval policy; this package only narrows Copilot-visible Tool Schemas and does not grant wider permissions.

The official release process publishes tarballs through the protected tag-triggered Release workflow. Repository tag rules and immutable-release settings protect new releases after publication. Verify the downloaded artifact against `SHA256SUMS` from the same GitHub Release before deployment.
