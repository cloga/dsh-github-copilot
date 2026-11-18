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

Plugin `0.1.0-alpha.14.dsh.0.2.2.rc.3` passed the Windows/Linux source and
published-artifact [CI](https://github.com/cloga/dsh-github-copilot/actions/runs/43691055529)
and was published to GitHub Releases and npm. This does not verify Desktop
artifacts, installation, loaded state or live supplier calls.

Use the read-only exact-Core selector from a verified source checkout to check
the release mapping:

```sh
node scripts/select-core-release.mjs 0.2.2-rc.3
```

The selector checks Release/npm metadata and named assets; it does not run CI,
hash downloaded bytes, or verify a loaded Desktop. Check those separately before
recommending installation. See [release selection and distribution](./docs/npm-distribution.md)
and the [model compatibility acceptance criteria](./docs/model-compatibility-acceptance.md).

## Use

After the exact compatible release is available and verified, download its
original asset and checksum in an empty directory:

```sh
curl -fLO https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.21.dsh.0.2.2.rc.3/dsh-github-copilot-0.1.0-alpha.21.dsh.0.2.2.rc.3.tgz
curl -fLO https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.21.dsh.0.2.2.rc.3/SHA256SUMS
sha256sum --check SHA256SUMS
```

For the `web` profile, install the same Release asset:

```sh
dsh plugin --profile web add https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.21.dsh.0.2.2.rc.3/dsh-github-copilot-0.1.0-alpha.21.dsh.0.2.2.rc.3.tgz
```

Choose the intended profile explicitly. Then:

1. In **Settings → Models**, add the native GitHub Copilot provider if it is
   not already configured; the plugin does not create that profile.
2. Use the GitHub Copilot account panel to sign in with GitHub.
3. Choose an account-available Copilot model in the native DSH model picker.
4. For subagents, use the native DSH model selection flow. Compatibility is
   limited to account-advertised and tested protocol capabilities.

No manually defined Copilot model, pasted token, external gateway, or
`copilot2api` service is required. Account and model availability are separate:
successful sign-in does not guarantee every model or capability is available.
The plugin does not register a second `github-copilot-preview` model provider.
Account-discovered model metadata is available for an explicitly reviewed sync
into the native `github-copilot` model list; discovery alone does not change the
native catalog or model selection.

To select enabled model IDs from the verified account used by the native provider in an existing
native provider, open **Manage → Model preferences**, review the displayed
additions, updates, removals and any IDs absent from the native catalog,
then choose **Sync models**. Preparing the display uses the current verified
account snapshot without forcing discovery; if it is unavailable, use
**Refresh models**. This one-time snapshot writes
`llm-pi-ai.providers.github-copilot.models` with Settings CAS and readback. It
may also set a missing route-wide API only under the verified conditions below.
The submitted list contains all enabled account model IDs as `{ id }` references;
it is not intersected with the installed native catalog. A successfully saved
list remains after the plugin is unloaded or uninstalled. Capacities, protocols,
image support and reasoning controls are resolved by the native adapter,
not copied or certified from account metadata. Differences
in account input limits, image formats or reasoning metadata no longer exclude
a model from this submission. IDs absent from the native catalog are advisory,
not skipped. If an enabled ID is absent and no route API is configured, the
preview may propose a provider-wide API only when all enabled account models
share the same verified protocol and every matching native catalog entry agrees.
The preview explains that this API applies to the whole route, not just missing
IDs. Existing route APIs are never overwritten; mixed, incomplete or conflicting
evidence blocks the sync. The model list and an authorized API change are written
together with Settings CAS and read back. Native validation remains authoritative;
a rejected or uncertain write is not reported as successful. Check the saved
settings before trying again.
**Sync replaces existing per-model customizations, including configured output
request defaults, with native definitions.** Review updated and removed entries
before confirming. Other route-wide settings remain unchanged. This selects a
model list; it does not prove supplier compatibility or enforce account-specific
limits. Native requests retain DSH's transport, validation and error behavior.
Custom native authentication,
endpoints, headers, nonempty model overrides, or unproven route compatibility
overrides block sync rather than changing those settings. An existing
`compat.supportsStrictMode: false` is preserved when at least one synced
Responses or Completions model supports that native override. An existing native default
reasoning effort is preserved for native resolution. ID-only entries do not add
per-model `maxTokens` request defaults. The sync does
not change credentials, select a model, alter history, or automatically follow
later account changes.

Use **Manage → Account management → Switch** in the native GitHub Copilot
account panel to apply a saved account to DSH's canonical
`llm-pi-ai/github-copilot` credential slot. This is profile-wide: subsequent
native requests use that account. The first switch preserves the prior native
OAuth grant as a saved account. In-progress requests are not redirected, and
the operation does not change model selections, provider settings or history.
Account switching does not change the native provider's bundled/configured
model catalog, which is not guaranteed to filter models by account entitlement.
The plugin does not add a separate Copilot model route. Existing
`github-copilot-preview` selections are not migrated and may become unavailable;
stored settings and conversation history remain unchanged. Legacy
preview-only Session account overrides and continuation controls do not apply
to native model calls. The old new-Session continuation default is no longer
shown; existing settings are preserved.
Starting the plugin or completing sign-in does not automatically repair the
native provider's settings.
The plugin registers optional `github-copilot-hosted` search in DSH's existing
Web service. Select it explicitly in native Web settings and enable the native
search tool as needed; installation does not change the selected backend.
Search uses only the canonical OAuth account and models shared by the native
configured catalog and current account metadata. In **Plugins → dsh-github-copilot
→ details → Copilot search model**, choose **Automatic** (the default) or one
eligible model. Opening or reloading this control fetches account metadata and
may refresh native OAuth; metadata alone does not prove search support. If an
explicitly selected model is no longer eligible, search fails without choosing
another model. Each search makes one fixed capability probe and, only after
proof, one user query; both may incur charges.
Custom endpoint, credential or transport overrides and unproven models remain
unavailable. There is no model retry, backend replacement or plugin routing UI.
When qualification succeeds, the native Auto reviewer's Copilot Responses requests
omit `temperature`; ordinary Chat and native allow/deny/error/cancel behavior remain
unchanged. Qualification uses the native adapter's pi-ai catalog even when
the plugin resolves a separate copy; missing protocol facts remain unavailable.
Native schema-default empty `chatTemplateKwargs`/`chatTemplateArgs` maps and a
boolean `supportsStrictMode` do not disqualify this route, including per-model
configuration. Other compatibility overrides remain unqualified. No settings
rewrite is needed to remove schema defaults; do not disable review or search
proof as a workaround. CI acceptance and live Desktop activation are separate.
See [reviewer compatibility](./docs/auto-review-sampling.md).

Plugin releases through alpha.12 can reject DSH's schema-default compatibility
maps and disable both enhancements ([#483](https://github.com/cloga/dsh-github-copilot/issues/483)).
The alpha.13 release fixes that qualification; live runtime behavior still
requires separate verification. Registration or model metadata alone proves
neither works.

The native route's quota and optional identity display use only the canonical OAuth account. If the
provider names a credential, endpoint or nonempty headers override, or its configuration
cannot be verified, quota is shown as unavailable rather than attributed to a
different account. This is not proof of request-level billing attribution.
Completed-turn Account evidence is also captured for the native provider, but
only after an actual native stream chunk for that admitted request. It reflects
the profile-wide account bound to the canonical credential, not a Session
override, billing attribution or subagent rollup. A mismatched account,
unproven native route or credential change before delivery leaves it unknown.
Explicitly configured native model IDs can qualify for account evidence even
when absent from the bundled catalog; this does not establish model support or
qualify them for search or reviewer protocol compatibility.
Evidence is Host-memory-only;
older turns and turns missing after a restart or eviction remain unknown.
Native context-incident diagnostics remain available without the optional
managed continuation service; they do not replace DSH's context meter.
The Local diagnostics feature has been removed. Existing diagnostic data and
settings are left untouched; older plugin versions may resume collection if
their saved switches remain enabled. See [retirement details](./docs/plugin-diagnostics.md).

### Other optional capabilities

- On the managed route, Credits can select an already saved account for a
  Session's subsequent turns. [Visible-history continuation](./docs/session-continuation.md)
  is a disclosed, lossy Responses policy; existing Sessions are not silently
  enrolled, and enabling it never sends or retries a message.
- [Segmented compaction recovery](./docs/manual-compaction-recovery.md) requires
  explicit engine selection; installing the plugin does not replace Core's engine.
- Managed Responses gzip is default-off. GitHub Enterprise Cloud tenant login
  is supported, while GHES and Enterprise quota are not.

### Removing the enhancement

Unloading the plugin removes its own routes, UI and listeners, not native
Copilot credentials, configuration, model selections or history. Native
**GitHub Copilot** remains usable with whichever account was last explicitly
applied to the canonical credential slot. Removing the plugin is not signing
out; explicit sign-out or removal of that authorization is a different action
and can affect native login.

Existing `github-copilot-preview` model selections are not migrated and may
become unavailable; explicitly select a native model where needed. If Web is
set to `github-copilot-hosted`, select another available backend in native Web
settings before removing the plugin. Removing the plugin does not rewrite Web
settings: a retained missing backend produces
`WEB_PROVIDER_CONFIGURED_MISSING`, not an automatic fallback. Additional-account
management and plugin-specific search require the plugin; the last selected
native OAuth grant remains in DSH's canonical credential record.

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
The optional [offline autonomy evaluator](./docs/agent-autonomy-evaluation.md)
analyzes explicitly supplied sanitized traces; it does not run or control agents.
PRs declare documentation impact; agent or human reviewers still verify semantic
accuracy and coverage. This adds no human-only approval gate. See
[contributing](./CONTRIBUTING.md#change-workflow).
Commit attribution must use an `Assisted-by` trailer for the actual assisting
tool; do not invent a co-author identity.

For behavior and qualification limits, see
[account integration](./docs/copilot-accounts.md),
[model compatibility](./docs/model-compatibility-acceptance.md), and
[distribution](./docs/npm-distribution.md).
