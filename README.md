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
curl -fLO https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.7.dsh.0.2.2.rc.3/dsh-github-copilot-0.1.0-alpha.7.dsh.0.2.2.rc.3.tgz
curl -fLO https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.7.dsh.0.2.2.rc.3/SHA256SUMS
sha256sum --check SHA256SUMS
```

For the `web` profile, install the same Release asset:

```sh
dsh plugin --profile web add https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.7.dsh.0.2.2.rc.3/dsh-github-copilot-0.1.0-alpha.7.dsh.0.2.2.rc.3.tgz
```

Choose the intended profile explicitly. Then:

1. In **Settings → Models → GitHub Copilot**, sign in with GitHub.
2. Choose an account-available Copilot model in the native DSH model picker.
3. For subagents, use the native DSH model selection flow. Compatibility is
   limited to account-advertised and tested protocol capabilities.

No manually defined Copilot model, pasted token, external gateway, or
`copilot2api` service is required. Account and model availability are separate:
successful sign-in does not guarantee every model or capability is available.
The plugin's account-discovered models and capabilities apply to the
`github-copilot-preview` route. DSH's native `github-copilot` route uses its
own bundled or configured catalog; the two routes do not automatically share
model discovery.

To copy enabled models from the current canonical account into an existing
native provider, use **Manage → Model preferences → Preview enabled models**,
review the additions, updates, removals, skipped models and per-request output
defaults, then choose **Apply sync**. This one-time snapshot replaces only
`llm-pi-ai.providers.github-copilot.models` with Settings CAS and readback.
Protocols, narrower server input caps, account-specific image MIME restrictions
and reasoning metadata that the native profile cannot express are skipped
rather than guessed. Core uses each configured `maxTokens` as that model's
per-request output default. The sync does not change credentials, select a
model, alter history, or automatically follow later account changes.

When adding DSH's native GitHub Copilot provider, use the separate plugin account
panel to sign in. With no named key, the native route uses a stored canonical
OAuth grant, not an independently selected additional account. Native and
managed routes can coexist: use **Manage → Account management → Switch**, then
choose a model under **GitHub Copilot (multi-account)** in the native picker.
Switching changes only the managed default; managed **Credits** can select an
account for that Session's subsequent turns. Native login, selected models and
running turns are not redirected. The native picker is not guaranteed
to filter its bundled catalog by account entitlement.
Starting the plugin or completing sign-in does not automatically repair the
native provider's settings.
The plugin registers optional `github-copilot-hosted` search in DSH's existing
Web service. Select it explicitly in native Web settings and enable the native
search tool as needed; installation does not change the selected backend.
Search uses only the canonical OAuth account and models shared by the native
configured catalog and current account metadata. Each search makes one fixed
capability probe and, only after proof, one user query; both may incur charges.
Custom endpoint, credential or transport overrides and unproven models remain
unavailable. There is no model retry, backend replacement or plugin routing UI.
The native Auto reviewer's qualified Copilot Responses requests omit
`temperature`; ordinary Chat and native allow/deny/error/cancel behavior remain
unchanged. Qualification uses the native adapter's pi-ai catalog even when
the plugin resolves a separate copy; missing protocol facts remain unavailable.
See [reviewer compatibility](./docs/auto-review-sampling.md).
The native route's quota and optional identity display use only the canonical OAuth account. If the
provider names a credential, endpoint or nonempty headers override, or its configuration
cannot be verified, quota is shown as unavailable rather than attributed to a
different account. This is not proof of request-level billing attribution.
Native context-incident diagnostics remain available without the optional
managed continuation service; they do not replace DSH's context meter.

### Removing the enhancement

Unloading the plugin removes its own routes, UI and listeners, not native
Copilot credentials, configuration, model selections or history. Independently
configured native **GitHub Copilot** remains usable with its original account.
Removing the plugin is not signing out; explicit sign-out or removal of the
original authorization is a different action and can affect native login.

Plugin-dependent selections do not become native automatically. Before removal,
explicitly select native models for Sessions/defaults using
`github-copilot-preview`. If Web is set to `github-copilot-hosted`, select another
available backend in native Web settings first. Removing the plugin does not
rewrite Web settings: a retained missing backend produces
`WEB_PROVIDER_CONFIGURED_MISSING`, not an automatic fallback. Additional-account
switching and plugin-specific search require the plugin.

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
