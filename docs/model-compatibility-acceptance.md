# Copilot model compatibility acceptance

The product is a plugin-only, account-driven GitHub Copilot model integration
for DSH. It reuses DSH/pi-ai OAuth, credentials, the published adapter, native
model selection, and native AgentLoop. It does not create another login, wire,
catalog, selection strategy, or agent runtime. Follow the
[confirmed scope](../AGENTS.md#confirmed-product-scope-455-456).

## Exact target and evidence

The current candidate targets official DSH `0.2.2-rc.3` at
`38a6a5c965aa99ab525161efb7cc5cf1fe62fced`, with the exact dependency versions
in `package.json`. It is pending required CI and is not a supported or
installable release. Desktop artifact/signature evidence, live OAuth, supplier
model availability, and loaded-runtime behavior are separate and unverified.

Use the exact published source and package graphs in the Windows/Linux CI
fixtures. Do not patch Core or dependencies. The fixtures use synthetic
credentials and local synthetic HTTP only; they prove no live account,
endpoint, supplier behavior, publication, installation, or Desktop activation.

## Required behavior

1. **Account-driven discovery.** Read bounded model metadata from the authorized
   Copilot account. New model IDs with supported endpoint and capability
   metadata must work without name-prefix branches or a static model list.
   Missing, conflicting, or unsupported metadata must produce a specific
   diagnostic rather than guessed capabilities.
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
  supported Thinking, and account-bound routing.
- Run source/test typechecks, the full Windows/Linux test/build/package matrix,
  tagged-source and published-artifact fixtures, and exact archive verification.
  Do not weaken or skip required CI to make an unsupported candidate pass.

## Out of scope

HydraFusion/Max, plugin-owned Auto and parent-follow policy, hosted-search
routing, a second agent loop, and broad recovery/analytics products are not part
of this model-integration target. DSH retains those native responsibilities.
Compatibility code may remain only where needed to preserve existing settings
or histories safely; it must not reactivate retired product UI or mutate user
data. No DeepSeek credential reader, login check, or forced account gate is
added.

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
