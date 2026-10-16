# Official-first qualification: DSH 0.2.1-alpha.4

## Fixed target and admission

Tracking: [#420](https://github.com/cloga/dsh-github-copilot/issues/420),
consolidating the still-open [alpha.2 review #397](https://github.com/cloga/dsh-github-copilot/issues/397).
The fixed candidate is official
[`dsh-v0.2.1-alpha.4`, `86a402200d95fecef4529d969836f1fe13c6cb0d`](https://github.com/deepseek-ai/deepseek-harness/tree/86a402200d95fecef4529d969836f1fe13c6cb0d).
Facts refreshed on 2026-10-16: the release is a prerelease with no GitHub
assets; upstream default branch is `master`, then at
`1517a4dbca0a2789ff1d41ba439600f8547d23fa`. Later upstream changes are not part
of this qualification. Plugin source started at
`2d8240c22f59a91881c32027501031fe8d534bb7` (0.4.2-alpha.15).

**Exact source/npm target for alpha.16.** Production engines, peers, SDK pin,
current baseline and release gates move together to alpha.4 following the
[four-way qualification](https://github.com/cloga/dsh-github-copilot/actions/runs/38907213734).
The isolated fixture first changed only its own requirements to exact alpha.4
packages and pi-ai 1.1.0; it neither patched dependencies nor substituted alpha.2.
Eleven earlier pins remain historical; rc.2 hosts must retain alpha.15.
The adapter's own `^1.1.0` dependency remains upstream-owned: inspection reports
its actual resolved SDK separately from the plugin's exact SDK. The bidirectional
public event-stream type proof must pass against those actual resolutions.

Local authorized-registry reads returned `ERR_PNPM_PACKAGE_NOT_FOUND` for both
`@deepseek-ai/dsh-agent@0.2.1-alpha.4` and
`@deepseek-ai/dsh-llm-pi-ai@0.2.1-alpha.4`; the adapter version list ended at
alpha.2. Direct official npm access failed TLS negotiation. These facts do not
establish worldwide absence. [The first candidate CI](https://github.com/cloga/dsh-github-copilot/actions/runs/38901591104)
successfully read and downloaded official alpha.4 artifacts on both platforms.
It exposed real strict peer failures: Cordis `~4.0.5-alpha.2`, Loader
`~1.0.6-alpha.2` and schemastery `~3.18.5-alpha.2` cannot use the old exact
development versions. The isolated candidate manifest now aligns those exact
tagged versions without changing transitive dependencies or disabling strict
peer checks. No missing-mirror result authorizes rebuilding Core, weakening
required gates, broadening engines, or using `allow-version`.

The next candidate typecheck exposed the public storage-domain schema's exact
Zod 4.4.3 type versus the plugin's newly resolved Zod 4.6.5 (incompatible
`_zod.version.minor`). The candidate now pins its own Zod to the official
storage-domain's exact 4.4.3 contract; no Core dependency is overridden, and
schema/runtime regressions must still pass. This is API alignment, not a
registry-failure substitution or a cast around the mismatch.

## Executed qualification

The fixed candidate workflow on commit `e88acc4` passed all four jobs:
Windows/Linux, each with unchanged official npm artifacts and (for tagged jobs)
the complete unchanged official source closure. Each artifact population ran
2,791 ordinary tests (two expected ordinary skips), three new native adapter
contracts, four native storage/gateway tests and all 28 reviewer tests, with an
explicit zero-skipped reviewer assertion. Tagged populations additionally ran
27 native/adapter suites including account persistence, account/Session
isolation, CAS, exclusions, parent/Auto, replay/compaction, Usage and the real
Credits selector mount; no Core tracked file was changed.

The new native adapter regressions prove normalized initial/system/deferred-tool
delivery, unchanged exact effort, undeclared-tool refusal before dispatch and
bounded TIMEOUT settlement with noncooperative iterator return. Existing native
and managed replay/Thinking/three-protocol tests remain in the ordinary suites.
SDK timestamp/duration fields alone are normalized in equivalence assertions.
This is synthetic runtime evidence, not live supplier acceptance.

Failures were resolved rather than skipped: the dual ESM Client carrier maps to
its public source; native gateway calls bind a public owner Peer with scoped
teardown, interactive Client events declare `interactions: answer`, and
Session-controller fixtures register resources. The reviewer now requires a
synthetic public working-directory service. The mounted Client fixture was
updated for current account/Session/continuation namespaces; the real selector
and renderer remain unchanged. The additional production Chat gate exposed a
new required `useGroupAction` renderer prop and demonstrated that the unchanged
native renderer already suppresses blank Thinking rows. The redundant plugin
renderer/provenance projection and obsolete interception tests are retired;
native settled/running/interrupted rendering remains an explicit gate.
No test principal, synthetic credential or quota
read contacts a live service.

Local pre-admission rc.2 source/types/build/baseline and focused regression
checks passed. A full local suite had one compression-fixture timeout; its exact
16-test suite passed on rerun, and tooling/package checks passed. After production
manifest alignment, `pnpm install --frozen-lockfile --ignore-scripts` verified the
unchanged lock but the authorized mirror returned HTTP 404 for
`@smithy/core@3.36.0`. Local alpha.4 validation is blocked, not passed.
The lock is metadata generated by the authorized official-registry candidate
CI, with every production requirement compared exactly before adoption; no
package blob was proxied and no registry restriction bypassed. Final protected
production CI remains authoritative before merge/publication.

## Evidence method

The rc.2 and alpha.4 complete Git trees both report `truncated: false`. File
hashes, rather than the truncated 300-file compare response, locate changes.
Exact candidate source was read from the fixed GitHub archive; no Core
implementation checkout, commit, build or installation was created. Archive
symlinks unsupported by Windows extraction are not used as evidence.

Links below resolve to the fixed candidate. “Complete” means the described
official source contract exists, not that plugin/runtime qualification passed.
“Partial” identifies a concrete remaining plugin responsibility. “Unverified”
is not a finding that upstream lacks the behavior.

## Owned-surface decisions

| Surface | Official source support and remaining gap | Decision / concrete retirement trigger |
|---|---|---|
| Startup and profile composition | **Complete admission contract:** [`plugin-compatibility.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/boot/app-boot/src/plugin-compatibility.ts) prioritizes an own `engines.dsh`; legacy peer fallback does not rescue the rc.2 manifest. Preflight disables incompatible entries. Package reload/resume improvements do not waive admission or prove profile peer resolution. | **Migrate after qualification**, not an exemption or range-only fix. Retain the public conditional authorization bootstrap and ordered bundle preflight until equivalent profile/optional-service tests pass. Signed Desktop shared-peer evidence is a separate gate. |
| Account isolation, OAuth and certified refresh | **Partial:** [`auth.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/llm/llm-pi-ai/src/auth.ts) still injects a public `CredentialStore` and serializes refresh through `modifyRecord`; [`login.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/llm/llm-pi-ai/src/login.ts) addresses provider-derived records. Credential watcher disposal changed, not account/turn freezing or plugin refresh certification. | **Retain** independently authorized plugin records, public Cordis `symbols.original` service identity, one exact notification plus committed-object/readback proof and invalidation fences. Retire only for an official account-bound API with equivalent isolation, refresh and mutation-fence acceptance; never copy canonical grants. |
| Account metadata, Thinking and exclusions | **Partial:** [`adapter.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/llm/llm-pi-ai/src/adapter.ts) keeps public profile/provider injection, validates effort and describes supported levels. New UI custom-model effort editing does not prove live Copilot endpoint/capability discovery or exclusion admission. | **Migrate** the isolated SDK bridge to exact 1.1.0 only after source/test types, all three protocols, public summaries, arbitrary metadata IDs, images and two-turn replay pass. **Retain** account-driven descriptors and exact-ID turn-scoped exclusions until official equivalent metadata/admission is proven. No new ID tables or guessed dynamic capabilities. |
| Auto demand, parent following and review | **Partial:** agent/model-selection ownership remains public; the plugin's demand/category/cost/intent policy is not replaced by native tool authorization review. [`auto-review`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/experimental/auto-review/src/index.ts) still freezes `temperature: 0`. The original rc.2-only identity qualification failed on alpha.4. | **Retain policy** unchanged. **Migrated qualification:** alpha.4 exact package, same-profile import and exported `apply` callback equality pass all 28 native reviewer tests on both source/artifact platforms; identity is never a name/range match alone. Retirement requires official per-request sampling compatibility plus allow/deny/malformed/error/cancel, disposal and concurrent Chat evidence. No routing-policy iteration or durable decisions are authorized here. |
| Hosted search | **Partial:** public `ctx.web`, current initiating Agent, `GenerateOptions` and native adapter composition remain the boundaries. Changed generic model catalogs do not establish account entitlements, hosted-search proof, or safe final-query retry. | **Retain** bounded proof, explicit search model and account-bound routing, file delegation and one final query. Retire only for an official provider-owned account-scoped equivalent with real initiating-Session/probe/override coverage; source-only equivalence remains unverified. |
| Dynamic system and tool updates | **Complete native representation / partial managed enablement:** [`context.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/llm/llm-pi-ai/src/context.ts) converts developer text/tool additions/removals into system updates; [`models.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/llm/llm-pi-ai/src/models.ts) advertises update modes only from exact compat capabilities. The SDK collection still normalizes the raw context before provider `streamSimple`. No demonstrated prompt/tool loss. | **Delegate native conversion** and test initial prompt, deferred tool addition, exact effort, undeclared-tool refusal and final normalized transcript at the bridge. Do not enable managed mid-conversation capabilities from generic SDK support alone. Retire local schema compatibility only after native Copilot payloads preserve its escalation/action guarantees. |
| Admission, files, images and replay | **Partial:** native conversion/image-offload remains the owner; [`replay.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/llm/llm-pi-ai/src/replay.ts) retains version-2 opaque response/block state, adding response model, provider effort and tool namespace fields. Old incompatible envelopes degrade through native diagnostics, not plugin history conversion. | **Retain** final normalized-message token admission, complete tool spans, image media checks and consent-bound outgoing reasoning filtering. Verify new metadata survives native round trips without inspecting/decrypting opaque state. Retire only when native admission expresses the account's distinct prompt/output limits and approved replay policy. No history truncation, fabricated usage or new retry. |
| Compaction and continuation | **Partial:** all five BasicCompactionEngine files (`config/index/region/summarizer/types`) are byte-identical to rc.2; token-meter `estimate/index/types/turn-usage` are also unchanged. Public compaction service types evolved, but this does not subsume bounded segmented recovery or visible-history consent. | **Retain** alpha.15 native-token planning, balanced tool ranges, bound-preset service lookup, native final admission/transaction commit and at most 16 physical calls. Retirement needs equivalent oversized-summary, typed capacity recovery, cancellation, preset, off-switch and commit evidence. Native `/compact` is not blanket recovery consent. |
| Liveness and cleanup | **Complete native abandonment fix / partial byte observation:** candidate [`adapter.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/llm/llm-pi-ai/src/adapter.ts) races `watchdog.next` and detaches `iterator.return` after abort. It no longer awaits a generator queued behind a hung demand. It still observes semantic chunks rather than raw SSE heartbeat bytes. | **Use native cleanup**, with a noncooperative-stream timeout regression. **Retain** separate managed HTTP byte-idle guard, consumer pause/resume and bounded semantic deadline until official raw-byte/consumer timing is equivalent. No extra cancellation owner, fake output or retry is added. |
| Credits, context evidence and historical Usage | **Partial:** [`TurnUsagePanel.tsx`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/client/ui-chat/src/client/chat/TurnUsagePanel.tsx) and token-meter turn usage are unchanged. Native route attribution remains all-or-nothing; split input stats does not prove the additive plugin docks broke. | **Retain** quota versus context separation, quiet ordinary progress, incident-only notices, complete native accounting and bounded requested/recorded model explanation. Retire only with equivalent native account credits and complete historical evidence, not reconstructed picker state. Missing Usage remains unknown. |
| Blank Thinking presentation | **Complete native behavior:** [`AssistantMarkdown.tsx`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/client/ui-chat/src/client/chat/AssistantMarkdown.tsx) ignores reasoning whose trimmed text is empty. Actual native rendering produces one public-summary disclosure instead of the old sixteen rows, without the plugin projection. | **Retire** the plugin renderer wrapper, origin projection and obsolete interception tests. Retain native rendering acceptance for empty/whitespace rows, visible answer/public summary and settled/running/interrupted states. No durable data, replay, Usage or independent Auto explanation changes. The concrete retirement trigger is now met, unlike other merely similar native features. |
| Diagnostics, HTTP 408 and gzip | **Partial:** public [`storage-domain`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/storage/storage-domain/src/index.ts) retains caller-owned domain handles and strict open/error lifecycle. SDK public Fetch/payload observation remains needed; no reviewed source establishes a supplier 408 remedy. | **Retain** independent consent, bounded retention/storage, epoch clear, fixed diagnostics, clone-only 408 evidence, cancellation attribution and opt-in gzip. Retirement needs equivalent content-free public observation and consent semantics; do not change native transport/retries/Usage to collect evidence. Local body-write completion is not supplier receipt. |
| Client slots and strict Remotes | **Complete declarations / synthetic runtime acceptance:** Models `settings.models.provider-card`, Credits `conversation.composer.dock`, notices `conversation.input.dock` and historical `conversation.chat.assistant-actions` remain in exact source. Actual strict gateways, native account CAS/restart and the built Credits Client under the real selector/renderer now pass; declaration presence alone was insufficient. | **Retain** scoped additive slots, captured namespace identities, strict `create`/schema codecs, explicit viewed Session/turn IDs and native Host lookup. Retire only for an equivalent official account/credits/history surface with matching mount/teardown and isolation coverage. No DOM takeover or retired role UI; synthetic mounting is not live Desktop activation. |
| Experimental plugin records | **Complete experimental seam / unverified migration:** [`appendPluginRecord` / `pluginRecordOf`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/core/session/src/index.ts#L469-L512) are newly public and ignorable, outside model-visible history. This changes the old “no seam” assessment, not authorization to start recording. | **Defer adoption** as separate reviewed behavior work. Continue bounded Host-lifetime evidence with unknown after restart. Adoption/retirement requires explicit payload, Session/turn, fork/resume, old-reader, rollback and consent review; no new records in this qualification. |

Only demonstrated native blank-reasoning presentation retires its redundant
plugin counterpart; source similarity alone retires nothing else. The native
cleanup fix is an upstream-owned improvement to verify, not a plugin patch to
copy. The SDK-free rewrite proposed as a possibility in #397 is not a
prerequisite: the exact root adapter export still lacks a complete replacement
for account-bound SDK factories, OAuth and public request hooks.

## Acceptance and delivery fence

The dedicated qualification workflow was separate from rc.2 release CI. It first
verified official npm artifact availability on Windows and
Linux, then prepares an exclusive plugin-only fixture, inspects real public
class paths and both SDK resolutions, typechecks, and runs the synthetic suites
and candidate-specific native adapter regressions. Failed or unexecuted stages
must remain failures/unknown; passing preparation is not runtime qualification.

Required delivery evidence after the isolated qualification:

- Retain the executed candidate-specific regressions and all existing real account,
  refresh, exclusion, Remote, UI-mount, compaction, diagnostics and reviewer
  fixtures against both unchanged exact tagged source and published artifacts.
- Preserve the exact reviewer identity proof; no reviewer fixture skips or version-only
  broadening. Align package peers/engines, baseline, Agent contract/verifiers,
  supported CI, SDK pin and both READMEs together. The prepared alpha.16 changes
  do so; the final production matrix must independently pass.
- Run the full gate, review the diff and merge only through protected green CI.
  Then publish one original archive to GitHub/npm and verify tag/commit,
  prerelease channel, SHA-256 and npm SRI. Do not release an unqualified target.

The Windows nightly feed
`https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml` failed TLS
negotiation during the earlier exact-target investigation. No candidate
Desktop artifact/signature, installation, loaded plugin, OAuth, live model,
hosted search, profile/settings/history migration or runtime health is claimed.
Source/npm qualification cannot substitute for those layers. #397 must remain
open until its checklist is either evidenced by #420 or explicitly deferred,
not blindly closed on consolidation.
