# dsh-github-copilot

[![CI](https://github.com/cloga/dsh-github-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/cloga/dsh-github-copilot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cloga/dsh-github-copilot)](https://github.com/cloga/dsh-github-copilot/releases)
[![License](https://img.shields.io/github/license/cloga/dsh-github-copilot)](./LICENSE)

**English** | [简体中文](./README.zh.md)

Add account-available GitHub Copilot models to DeepSeek Harness (DSH). The
plugin reuses DSH's GitHub Copilot OAuth and published model adapter; it does
not add another login, model wire, static catalog, or agent loop.

**Plugin-only implementation:** all implementation changes remain
plugin-only and use published public DSH APIs. The plugin does not modify,
patch, rebuild, or replace DSH Core or dependency artifacts.

## Scope and ownership

- DSH owns application authentication, model selection, Auto, tools, Web,
  subagents, permissions, history, context management, and Usage.
- Parent/child relationships, inheritance, and scheduling follow native DSH.
  The plugin adds models, not a separate subagent or child-account policy.
- This plugin connects GitHub Copilot authorization, discovers models and
  capabilities from the authorized account, and composes the published native
  adapter with only verified Copilot-specific compatibility handling.
- GitHub Copilot account quota remains available; it is separate from DSH's
  native token Usage.
- Native subagents selecting and actually invoking account-available Copilot
  models are a required compatibility goal. A picker entry alone is not
  sufficient evidence. Unsupported or incomplete endpoint/capability metadata
  must fail explicitly rather than be guessed.
- HydraFusion and HydraFusion Max are out of scope. The plugin does not add a
  DeepSeek credential check, silently switch providers, or retry a failed
  Copilot request through another provider.

The candidate still mounts legacy planner/executor compatibility and optional
recovery and analytics. Useful enhancements are retained; only demonstrably
unnecessary functionality is a retirement target. It does not provide a
separate subagent runtime.

The intended environment is a normally configured DSH app with its usual
DeepSeek-backed features, plus GitHub Copilot authorization for Copilot models.
The plugin does not inspect or enforce the user's DeepSeek account status.

## Compatibility status

This line targets official DSH `0.2.2-rc.3`. A source checkout or pending
mapping is not proof of qualification or publication. Before installing,
confirm that the exact version has passed the required gates and its Release
and npm artifacts are available. Published, installed, and loaded states are
distinct.

Use the read-only exact-Core selector from a verified source checkout to check
the release mapping:

```sh
node scripts/select-core-release.mjs 0.2.2-rc.3
```

It must report a fully verified published release before an install is
recommended. See [release selection and distribution](./docs/npm-distribution.md)
and the [model compatibility acceptance criteria](./docs/model-compatibility-acceptance.md).

## Use

After the exact compatible release is available and verified, download its
original asset and checksum in an empty directory:

```sh
curl -fLO https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.2.dsh.0.2.2.rc.3/dsh-github-copilot-0.1.0-alpha.2.dsh.0.2.2.rc.3.tgz
curl -fLO https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.2.dsh.0.2.2.rc.3/SHA256SUMS
sha256sum --check SHA256SUMS
```

For the `web` profile, install the same Release asset:

```sh
dsh plugin --profile web add https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.2.dsh.0.2.2.rc.3/dsh-github-copilot-0.1.0-alpha.2.dsh.0.2.2.rc.3.tgz
```

Choose the intended profile explicitly. Then:

1. In **Settings → Models → GitHub Copilot**, sign in with GitHub.
2. Choose an account-available Copilot model in the native DSH model picker.
3. For subagents, use the native DSH model selection flow. Compatibility is
   limited to account-advertised and tested protocol capabilities.

No manually defined Copilot model, pasted token, external gateway, or
`copilot2api` service is required. Account and model availability are separate:
successful sign-in does not guarantee every model or capability is available.

When adding DSH's native GitHub Copilot provider, use the separate plugin account
panel to sign in. With no named key, the native route uses a stored canonical
OAuth grant, not an independently selected additional account. While the
managed route remains registered, saving the native provider can block
additional-account requests and switching. The native picker is not guaranteed
to filter its bundled catalog by account entitlement.
Starting the plugin or completing sign-in does not automatically repair the
native provider's settings.
The native route's quota display uses only the canonical OAuth account. If the
provider names a credential, endpoint or headers override, or its configuration
cannot be verified, quota is shown as unavailable rather than attributed to a
different account. This is not proof of request-level billing attribution.

Desktop's native package manager and its bundled CLI have different contracts
from a standalone profile. Review the [Desktop CLI evidence](./docs/npm-distribution.md#desktop-bundled-cli-on-official-rc2)
and [standalone maintenance procedure](./docs/npm-distribution.md#controlled-offline-cli-maintenance-for-standalone-profiles)
before installation; the rc.2 evidence does not establish rc.3 behavior.
Installation does not automatically run this preflight: the read-only
`scripts/check-search-composition.mjs` check detects conflicting legacy Web
configuration but does not prove runtime health. Preserve and review existing
profile data, and obtain separate approval before installation or restart.

## Development and delivery

The exact development target is in `deployment-baseline.json`; follow
[AGENTS.md](./AGENTS.md) before changing code. The required complete verification
and package/release gates run in GitHub Actions. A successful local source
check, synthetic fixture, release publication, profile installation, and loaded
Desktop runtime are different evidence layers; report each accurately.
Commit attribution must use an `Assisted-by` trailer for the actual assisting
tool; do not invent a co-author identity.

For behavior and qualification limits, see
[account integration](./docs/copilot-accounts.md),
[model compatibility](./docs/model-compatibility-acceptance.md), and
[distribution](./docs/npm-distribution.md).
