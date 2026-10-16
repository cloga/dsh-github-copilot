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

**Not admitted.** Production engines, peers, SDK pin, current baseline and
release gates remain rc.2 until qualification succeeds. The isolated candidate
fixture changes only its own requirements to exact alpha.4 packages and pi-ai
1.1.0; it neither patches dependencies nor substitutes alpha.2 packages.
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
| Auto demand, parent following and review | **Partial:** agent/model-selection ownership remains public; the plugin's demand/category/cost/intent policy is not replaced by native tool authorization review. [`auto-review`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/experimental/auto-review/src/index.ts) still freezes `temperature: 0`. Current plugin callback/package qualification deliberately pins rc.2, so candidate identity is unproven. | **Retain policy** unchanged. **Requalify** alpha.4 exact package, same-profile import and exported `apply` callback equality through the real native reviewer; never weaken identity to a name/range match. Retirement requires official per-request sampling compatibility plus allow/deny/malformed/error/cancel, disposal and concurrent Chat evidence. No routing-policy iteration or durable decisions are authorized here. |
| Hosted search | **Partial:** public `ctx.web`, current initiating Agent, `GenerateOptions` and native adapter composition remain the boundaries. Changed generic model catalogs do not establish account entitlements, hosted-search proof, or safe final-query retry. | **Retain** bounded proof, explicit search model and account-bound routing, file delegation and one final query. Retire only for an official provider-owned account-scoped equivalent with real initiating-Session/probe/override coverage; source-only equivalence remains unverified. |
| Dynamic system and tool updates | **Complete native representation / partial managed enablement:** [`context.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/llm/llm-pi-ai/src/context.ts) converts developer text/tool additions/removals into system updates; [`models.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/llm/llm-pi-ai/src/models.ts) advertises update modes only from exact compat capabilities. The SDK collection still normalizes the raw context before provider `streamSimple`. No demonstrated prompt/tool loss. | **Delegate native conversion** and test initial prompt, deferred tool addition, exact effort, undeclared-tool refusal and final normalized transcript at the bridge. Do not enable managed mid-conversation capabilities from generic SDK support alone. Retire local schema compatibility only after native Copilot payloads preserve its escalation/action guarantees. |
| Admission, files, images and replay | **Partial:** native conversion/image-offload remains the owner; [`replay.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/llm/llm-pi-ai/src/replay.ts) retains version-2 opaque response/block state, adding response model, provider effort and tool namespace fields. Old incompatible envelopes degrade through native diagnostics, not plugin history conversion. | **Retain** final normalized-message token admission, complete tool spans, image media checks and consent-bound outgoing reasoning filtering. Verify new metadata survives native round trips without inspecting/decrypting opaque state. Retire only when native admission expresses the account's distinct prompt/output limits and approved replay policy. No history truncation, fabricated usage or new retry. |
| Compaction and continuation | **Partial:** all five BasicCompactionEngine files (`config/index/region/summarizer/types`) are byte-identical to rc.2; token-meter `estimate/index/types/turn-usage` are also unchanged. Public compaction service types evolved, but this does not subsume bounded segmented recovery or visible-history consent. | **Retain** alpha.15 native-token planning, balanced tool ranges, bound-preset service lookup, native final admission/transaction commit and at most 16 physical calls. Retirement needs equivalent oversized-summary, typed capacity recovery, cancellation, preset, off-switch and commit evidence. Native `/compact` is not blanket recovery consent. |
| Liveness and cleanup | **Complete native abandonment fix / partial byte observation:** candidate [`adapter.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/llm/llm-pi-ai/src/adapter.ts) races `watchdog.next` and detaches `iterator.return` after abort. It no longer awaits a generator queued behind a hung demand. It still observes semantic chunks rather than raw SSE heartbeat bytes. | **Use native cleanup**, with a noncooperative-stream timeout regression. **Retain** separate managed HTTP byte-idle guard, consumer pause/resume and bounded semantic deadline until official raw-byte/consumer timing is equivalent. No extra cancellation owner, fake output or retry is added. |
| Credits, context evidence and historical Usage | **Partial:** [`TurnUsagePanel.tsx`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/client/ui-chat/src/client/chat/TurnUsagePanel.tsx) and token-meter turn usage are unchanged. Native route attribution remains all-or-nothing; split input stats does not prove the additive plugin docks broke. | **Retain** quota versus context separation, quiet ordinary progress, incident-only notices, complete native accounting and bounded requested/recorded model explanation. Retire only with equivalent native account credits and complete historical evidence, not reconstructed picker state. Missing Usage remains unknown. |
| Diagnostics, HTTP 408 and gzip | **Partial:** public [`storage-domain`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/storage/storage-domain/src/index.ts) retains caller-owned domain handles and strict open/error lifecycle. SDK public Fetch/payload observation remains needed; no reviewed source establishes a supplier 408 remedy. | **Retain** independent consent, bounded retention/storage, epoch clear, fixed diagnostics, clone-only 408 evidence, cancellation attribution and opt-in gzip. Retirement needs equivalent content-free public observation and consent semantics; do not change native transport/retries/Usage to collect evidence. Local body-write completion is not supplier receipt. |
| Client slots and strict Remotes | **Complete declarations / unverified candidate mounting:** Models `settings.models.provider-card`, Credits `conversation.composer.dock`, notices `conversation.input.dock` and historical `conversation.chat.assistant-actions` remain in exact source. Gateway/remotes/slot-renderer source changed, so declaration presence is not runtime proof. | **Retain** scoped additive slots, captured namespace identities, strict `create`/schema codecs, explicit viewed Session/turn IDs and native Host lookup. Require actual Client/Host gateways, native CAS/restart and mounted teardown tests before admission; synthetic proxy calls alone are insufficient. No DOM takeover or retired role UI. |
| Experimental plugin records | **Complete experimental seam / unverified migration:** [`appendPluginRecord` / `pluginRecordOf`](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/core/session/src/index.ts#L469-L512) are newly public and ignorable, outside model-visible history. This changes the old “no seam” assessment, not authorization to start recording. | **Defer adoption** as separate reviewed behavior work. Continue bounded Host-lifetime evidence with unknown after restart. Adoption/retirement requires explicit payload, Session/turn, fork/resume, old-reader, rollback and consent review; no new records in this qualification. |

No plugin behavior is retired merely because candidate code exists. The native
cleanup fix is an upstream-owned improvement to verify, not a plugin patch to
copy. The SDK-free rewrite proposed as a possibility in #397 is not a
prerequisite: the exact root adapter export still lacks a complete replacement
for account-bound SDK factories, OAuth and public request hooks.

## Acceptance and delivery fence

The dedicated candidate workflow is deliberately separate from supported rc.2
release CI. It first verifies official npm artifact availability on Windows and
Linux, then prepares an exclusive plugin-only fixture, inspects real public
class paths and both SDK resolutions, typechecks, and runs the synthetic suites
and candidate-specific native adapter regressions. Failed or unexecuted stages
must remain failures/unknown; passing preparation is not runtime qualification.

Required next evidence before any admission/release-bearing adaptation:

- Execute the candidate-specific regressions and all existing real account,
  refresh, exclusion, Remote, UI-mount, compaction, diagnostics and reviewer
  fixtures against both unchanged exact tagged source and published artifacts.
- Preserve the exact reviewer identity proof; no fixture skips or version-only
  broadening. Align package peers/engines, baseline, Agent contract/verifiers,
  supported CI, SDK pin and both READMEs together only after failures are fixed.
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
