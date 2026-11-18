# Copilot model compatibility acceptance

The product is a plugin-only, account-driven GitHub Copilot model integration
for DSH. It reuses DSH/pi-ai OAuth, credentials, the published adapter, native
model selection, and native AgentLoop. It does not create another login, wire,
catalog, selection strategy, or agent runtime. Follow the
[confirmed scope](../AGENTS.md#confirmed-product-scope-455-456).

## Exact target and evidence

Current source target: official DSH `0.2.2-rc.5` at
`9c2670d3bce5275e0d1610272958121af87787bb`, with exact dependency versions
in `package.json`.

Plugin `0.1.0-alpha.14.dsh.0.2.2.rc.3` at
`5d82df760683eeae7bb0413c946e4d25daef2049` passed the required Windows/Linux
source and published-artifact matrix in
[CI 43691055529](https://github.com/cloga/dsh-github-copilot/actions/runs/43691055529)
and was published to GitHub Releases and npm. That evidence applies to that
revision, not later changes. Desktop artifact/signature evidence, installation,
live OAuth, supplier model
availability, and loaded-runtime behavior are separate and unverified.

Use the exact published source and package graphs in the Windows/Linux CI
fixtures. Do not patch Core or dependencies. The fixtures use synthetic
credentials and local synthetic HTTP only; they prove no live account,
endpoint, supplier behavior, publication, installation, or Desktop activation.

### Official-first rc.5 review

The [official Windows nightly mirror](https://github.com/cloga/dsh-github-copilot/releases/tag/desktop-v0.2.2-rc.5)
contains the unchanged, hash- and signature-verified installer. It is not the
different stable-channel build. Its `dsh/desktop-runtime.json` descriptor is
4,738,750 bytes (SHA-256
`bc7390d0088b9a4e850e3e3bf3c4bf7e3eaf09752c0505d20b6f8215640ee0e8`)
and lists 336 shared packages. Its peer ownership is checked against the
plugin manifest; this does not establish effective profile resolution, a loaded
plugin, or a live request.

| Area | Evidence and decision |
|---|---|
| Web search | **Partial:** [rc.5 Web](https://github.com/deepseek-ai/deepseek-harness/blob/9c2670d3bce5275e0d1610272958121af87787bb/packages/web/web/src/index.ts) prefers a usable native DeepSeek search backend according to the initiating model route when no backend is configured. Keep native selection; the plugin backend is available only when explicitly selected. Exact-source and published-artifact regressions must cover route preference, explicit selection and native tool context. |
| Native adapter and reviewer | **Partial:** the native catalog/configuration, model-selection and [reviewer entry](https://github.com/deepseek-ai/deepseek-harness/blob/9c2670d3bce5275e0d1610272958121af87787bb/packages/experimental/auto-review/src/index.ts) are unchanged from rc.3, and pi-ai remains `1.3.0`. Retain exact rc.5 package/callback and account proof; synthetic runtime qualification is still required. |
| Native errors and other features | **Unverified live:** rc.5 adds `CONTENT_REFUSED` to native LLM failures. Core remains the error and retry owner; the plugin does not add a fallback. Model, subagent, image and account behavior require the exact-version matrix, not a source-diff inference. |

Retire reviewer sampling or optional hosted search only after an official
equivalent and its configuration, account isolation and migration are verified.
Neither metadata nor this source comparison proves live supplier support.

## Required behavior

1. **Account-driven discovery.** Read bounded model metadata from the authorized
   Copilot account. New model IDs with supported endpoint and capability
   metadata must work without name-prefix branches or a static model list when
   the native provider can represent them. Updating its model list requires an
   explicitly confirmed sync to an existing profile; discovery alone does not
   register a provider or modify that list. Missing, conflicting, or unsupported
   metadata must produce a specific diagnostic rather than guessed capabilities.
2. **Native model use.** A discovered model must resolve through the published
   adapter and preserve native request ownership, errors, cancellation, and
   tool-result relationships. Sign-in or a picker entry alone is not proof of
   successful route preparation or invocation.
3. **Thinking and protocol capabilities.** Preserve supported reasoning
   efforts and native default semantics. Cover each protocol accepted by the
   account metadata and pinned adapter; unsupported controls fail explicitly
   without disabling otherwise usable requests.
4. **Native subagents (#456).** Verify the exact DSH model directory and
   authorization path, native subagent model listing, and actual child
   AgentLoop invocation of the selected Copilot model. Assert the outgoing
   model and supported reasoning effort, both child completion results,
   account binding/isolation, concurrency, and that unauthorized, unavailable,
   or unsupported selections fail before dispatch. A configured allowlist or
   visible picker row alone is insufficient. Parent/child relationships,
   inheritance, delegation, lifecycle, and scheduling remain DSH-owned. Do not
   introduce a plugin child-account mode or use lineage as credential authority.
5. **Account and turn isolation.** Requests, retries, discovery, and concurrent
   children must stay bound to the exact authorized account and turn. Global or
   Session selection changes cannot redirect admitted work. Missing selected
   accounts or permissions fail closed; there is no fallback to another
   account or provider. This checks the existing authenticated provider contract;
   it does not authorize designing parent-to-child account inheritance. If a
   native public seam cannot safely carry that contract, report the specific
   compatibility limit rather than implementing a separate child policy.
6. **Protocol correctness.** Preserve supported text, tools, images, public
   reasoning summaries, replay ownership, and cancellation through the native
   adapter. Do not add a second wire, silently trim history, rewrite history,
   retry through another provider, or claim supplier-side support from a
   synthetic response.
7. **Current SDK compatibility.** Pin and test the exact published pi-ai
   version used by this candidate (`1.3.0` in `package.json`). Do not assume a
   model catalog entry overrides authenticated account endpoint/capability
   evidence.
8. **Copilot account quota.** Preserve account quota and its presentation,
   distinct from DSH's native token Usage. Retain the existing account and
   consent boundaries without inferring quota from token estimates.

## Regression evidence

- Include arbitrary unseen model IDs and account metadata for every supported
  protocol; these must not require implementation-table changes.
- Cover missing/conflicting endpoints, malformed limits, unsupported reasoning,
  explicit account denial, stale snapshots, account changes, cancellation, and
  sanitized errors.
- Exercise the real published adapter with local synthetic responses for native
  text, tool calls/results, Thinking, images where supported, and interruption.
- Exercise native subagent selection and actual child model calls against the
  exact tagged Core and published package graph, including parallel children,
  supported Thinking, and account-bound routing. The two-account child fixture
  explicitly configures synthetic native models; the separate native-sync fixture
  verifies Settings persistence and resolution, not live supplier availability.
- Run source/test typechecks, the full Windows/Linux test/build/package matrix,
  tagged-source and published-artifact fixtures, and exact archive verification.
  Do not weaken or skip required CI to make an unsupported candidate pass.

## Out of scope

HydraFusion/Max, plugin-owned Auto and parent-follow policy, hosted-search
routing, and a second agent loop are not part of this model-integration target.
DSH retains its native responsibilities. Keep useful existing enhancements;
review recovery and analytics individually and remove only functionality shown
to be redundant or unnecessary. Preserve existing settings, histories and
consent without reactivating retired UI or mutating user data. No DeepSeek
credential reader, login check, or forced account gate is added.

## Delivery and upgrade

- Update this checklist and both READMEs when the actual supported contract
  changes; keep package metadata, deployment baseline, and release mapping
  aligned.
- Merge only after required reviews, branch protection, and green CI. Publish
  only the verified merged revision and verify the Release assets/checksum and
  npm version/integrity.
- Install only the verified compatible artifact into the intended local DSH
  profile after the required explicit installation authorization. Verify
  installed bytes and loaded runtime separately; a restart that interrupts
  sessions requires separate acknowledgement.
- Report each evidence layer and any unsupported capability or unperformed
  live check accurately.
