# Changelog

## 0.4.2-alpha.5 (prepared)

- Measure large request JSON composition up to 32 MiB with a cooperative,
  bounded span scanner instead of a full payload object graph. Preserve
  disjoint image/replay byte subsets, native original spans and explicit
  cancellation/time/work limits; replay validation keeps its 16 MiB boundary.
- Start opted-in large-body counting after Fetch invocation without holding
  up ordinary response/stream delivery. Fence late numeric updates to their
  own retained row across pause/re-enable, clear, teardown and eviction.
- Reuse bounded composition work in exact verified-408 guidance. Preserve
  native bytes, response/error, retries, Usage, timeout and default-off gzip;
  composition evidence does not establish a proxy or supplier fault.

## 0.4.2-alpha.4 (prepared)

- Add independently opt-in, content-free managed-adapter physical request
  observations to Local diagnostics: model/protocol, JSON/wire byte counts,
  bounded composition, local transport timings, HTTP status and strict terminal
  categories. Existing aggregate collection does not enable this scope.
- Retain at most 128 request rows for 24 hours within the shared 2 MiB snapshot.
  Expose dropped/expired/pending/reopen gaps, independent pause and confirmed
  clear, a native-style request table and explicit reviewed-JSON scope.
- Preserve native request bytes, retry decisions, stream results and accounting.
  Body-write completion is not supplier receipt; missing terminal text is not
  abort evidence. This improves investigation, not HTTP408/EOF/context recovery.
- Keep the offline account/compaction analyzer aggregate-only, with an explicit
  gap when separately collected request observations are omitted.

## 0.4.2-alpha.3 (prepared)

- Put daily Auto allocation aggregate rows in the primary Local diagnostics view, with UTC date, policy, model, decision cohort, opportunities, expected selections, selected counts and no-fit decisions. Keep cohorts distinct and state that these counts do not prove execution, quality or billing.
- Move account/Checking and compaction tables, collection controls, and data-scope/limits/JSON guidance into collapsed disclosures. Preserve status retry access, independent default-off switches and separately confirmed clear behavior.
- Match disclosure summaries and aggregate tables to native settings typography. Update bilingual usage guidance and add focused component regressions; no collection, CAS, storage, privacy or routing policy changes.

## 0.4.2-alpha.1 (publication blocked: immutable tag metadata)

- Persist bounded daily Auto allocation aggregates in the existing profile-isolated local diagnostics storage domain. The Auto collection switch is independent and default-off; enabling it does not enable account/Checking or compaction collection.
- Retain only fixed policy/model/category/demand/assessment/high-cost/continuity dimensions and bounded opportunity, expected-share, selected and no-fit counts. Cap Auto strata at 1,024 and retain for 14 days under the existing snapshot-size limit; expose restart, eviction, drop, truncation and saturation evidence.
- Preserve turn routing and Host-lifetime explanations when observation is disabled or fails. No Session/turn IDs, conversation data, upload, automatic tuning or execution/quality/billing inference is added.
- Add collector, UI, Remote codec and storage-gateway regression coverage; synthetic tests do not establish live Desktop activation or Auto performance.

## 0.4.2-alpha.2 (published)

- Carry forward the default-off local Auto allocation observations from the unpublished `0.4.2-alpha.1` candidate.
- Accept the repository's `(prepared)` changelog heading in the release preflight and verify exactly one version section before publishing.

## 0.4.1

- Upgrade from 0.4.0: fix normal plugin-owned same-account native OAuth refresh aborting concurrent already-dispatched managed HTTP streams with `COPILOT_PREVIEW_CREDENTIAL_CHANGED`.
- Qualify unchanged account, entitlements and official OAuth-derived endpoint through an exact single serialized credential notification and commit result. Immediately invalidate reusable metadata/prepared proof; subsequent requests resolve fresh native auth and metadata without redirecting a frozen account or replaying the user query.
- Keep unknown/external/Core-only notifications, duplicate/delayed/failed writes, revocation, cancellation and disposal fail-closed. Provider rejection remains an ordinary native error; this is not blanket invisible recovery or a new retry owner.
- Synthetic native-adapter and credential-store regressions establish this scope, not attribution of any particular live incident. Retain 0.4.0's original immutable tag/archive; use the new stable patch. No installation, restart or live settings mutation is included.

## 0.4.0

- First stable release, retaining official DSH / Windows Desktop 0.2.0-rc.2 support and plugin-only boundaries.
- Synchronize bilingual configuration documentation and synthetic built-Client screenshots. The same-account refresh interruption described above is corrected in 0.4.1.

## 0.4.0-alpha.134 (prepared)

- Automatically omit temperature only for the authenticated official rc.2 Auto reviewer root calling an account-proven managed Responses route. Ordinary concurrent Chat and other tool listeners retain their sampling; no opt-in or settings migration is required.
- Qualify the public service-read facade with profile package ownership and independent exported callback equality, before cloning and delegating through the native LLM pipeline. Missing/unknown reviewer identity, aliases, descendants, other protocols and canonical routes remain native. Dispose the plugin-owned listener and revoke delayed reviewer dispatch.
- Execute native reviewer fixtures explicitly on unchanged source and published artifacts with exact-count/no-skip receipts. Preserve strict verdicts and fail-closed tool denial. Earlier excluded published-fixture selector claims remain retracted; synthetic qualification is not live endpoint evidence.
- Keep the separate all-managed-Responses override default false and preserve immutable alpha.132/alpha.133 releases. No live settings, installation or restart is included.

## 0.4.0-alpha.133 (prepared)

- Correct the #374 temperature-compatibility claim: `supports.thinking` does not establish temperature support. Replace inferred omission with the explicit, default-off `github-copilot.responsesOmitTemperature` override.
- When explicitly enabled, omit temperature from every account-discovered managed Responses request, independent of model metadata or native transport selection. Document the all-request scope and tradeoff; preserve native reviewer fail-closed behavior, frozen options, cancellation and one-attempt semantics. The Core-owned canonical route remains outside scope.
- Add default-preservation coverage for thinking true/false/absent, opt-in omission coverage for each, dynamic-config/lazy-dispatch and account/cancellation fences, plus unchanged-source native reviewer verdict cases. Synthetic fixtures do not establish supplier semantics or live endpoint success.
- Preserve the immutable published `0.4.0-alpha.132`; this correction uses a new release version.

## 0.4.0-alpha.132 (published; inference superseded)

- This release inferred temperature incompatibility from `capabilities.supports.thinking`. That mapping is unsupported by a verified supplier contract and must not be treated as validated or automatically capability-derived mitigation. The default-off explicit override in alpha.133 replaces it.

## 0.4.0-alpha.131 (not published; superseded)

- Earlier draft proposed temperature omission based on `capabilities.supports.thinking`; the inference is not supported and was withdrawn in alpha.133.
- Preserve the unused `v0.4.0-alpha.131` tag after its noncanonical manual annotation was rejected by the protected publication workflow; that version was not published to GitHub Releases or npm and is never moved, reused or repacked.

## 0.4.0-alpha.130 (prepared)

- Add explicit offline analysis for a caller-selected persisted diagnostics unit or reviewed aggregate view (#368). Bound reads, reject unsafe/changed inputs, and write strict reports only to a new explicitly selected local file.
- Keep version, Client/Host, operation, terminal outcome and duration populations distinct. Preserve overflow and collection gaps; do not infer failure rates, live pending state, root cause or improvement from unmatched or persisted-only evidence.
- Synthetic tests cover read safety and report semantics; the first descriptive report remains private local evidence. No live profile read, collection change, upload, schedule, install or restart is part of release validation.

## 0.4.0-alpha.129

- Keep ordinary post-compaction steps and requests without a fresh usage sample quiet instead of repeatedly showing context-sampling uncertainty (#367).
- Notify only for a concrete failed-zero or invalid-sample incident. Bind dismissal to the Session and incident across ordinary remounts/switches; a later applicable valid sample clears the incident and a newer incident can notify.
- Preserve the existing eight-second native-confirmed compaction result, historical-count labeling, unknown-evidence diagnostics, native usage/context meters and Core-owned compaction/accounting without replacement percentages, retries or live installation.

## 0.4.0-alpha.128

- Separate native compaction commit, subsequent ordinary-request outcome and applicable historical input sampling in one composer disclosure (#364).
- Preserve transient completion expiry/Close without hiding independent context uncertainty; keep native compaction history, context ring and usage accounting unchanged.
- Track same-step retries and compaction resumed inside an already-open native step through strict bounded public projections, without an extra request, history write or replacement percentage.

## 0.4.0-alpha.127 (prepared)

- Expire the confirmed visible-history compaction success notice eight seconds after its first Client observation; keep running loss disclosure visible and add localized, accessible Close to settled, unavailable and authorization-required results (#363).
- Retain expiry and presentation-only dismissal across incidental remounts and Session switches within a registration-owned 128-record bound. Scope by Session, operation and status; ignore late reads and clean up timers without changing consent, native proof/history, sending or retries.
- Synthetic Client lifecycle evidence is not live Desktop or provider acceptance; no installation, restart or settings enablement.

## 0.4.0-alpha.126 (prepared)

- Align plugin-owned Models, account management, model preferences, continuation disclosures, Credits details and plugin settings with the unchanged official rc.2 font family, type scale, themed neutral controls and focus states (#361).
- Match compact provider actions to native Edit; keep Sign out and Refresh content-sized, and wrap model actions below long names/IDs on narrow layouts. Preserve authorization, CAS, preferences, continuation, quota and native UI ownership.
- Isolated real-component browser comparisons cover desktop/narrow widths and light/dark themes; they do not prove live Desktop activation or authorize installation/restart.

## 0.4.0-alpha.125 (prepared)

- Add the experimental, default-off `github-copilot.responsesRequestCompression` option: account-proven managed HTTP Responses JSON may use bounded, lossless gzip at the existing public Fetch boundary (#358).
- Retain the original JSON for native admission, retries, replay and diagnostics; skip unsuitable bodies, preserve caller-owned Fetch and native failure handling, and never resend uncompressed or trim history.
- Distinguish original composition bytes from prepared gzip body bytes in verified 408 guidance. Synthetic transport evidence is not proof of delivery, provider capability or universal timeout mitigation; no live install or enablement.

## 0.4.0-alpha.124 (prepared)

- Plan compaction from model-facing content and tools instead of serializing native IDs, provenance and opaque replay envelopes, fixing metadata-driven exhaustion of the unchanged 16-call bound (#352).
- Retain fixed system/tools and balanced tool units when reducing the budget after one typed native capacity failure; reject an indivisible unchanged retry. Preserve actual messages, final native admission, cancellation, account proof, diagnostics and single native checkpoint commit.
- Add exact-source native admission/transaction regression with synthetic metadata-heavy history. Synthetic tests do not establish live recovery; no automatic Session replay, engine migration or new timeout/network retry.

## 0.4.0-alpha.123 (prepared)

- Add default-off local account/Checking/compaction diagnostics with strict fixed-dimension counts, elapsed/unfinished age bins, separate Client/Host populations and explicit cancellation, rejection, interruption and reporting gaps (#347, #356).
- Persist a 14-day, 4,096-row/2 MiB aggregate snapshot through the public storage-domain service, isolating profiles on the home-wide backend. Add enable/pause, separately confirmed clear and aggregate-only JSON review; preserve restart interruption, control epochs, business ownership and named storage failures.
- No account/Session identity, content, replay, raw errors or credentials enter aggregates. No automatic uploads, daily tasks, repair, retries, live-profile install or activation; native/custom-engine and other unwrapped paths remain explicit coverage gaps.

## 0.4.0-alpha.121 (prepared)

- Add explicit `/copilot-compact visible-history` consent for one lossy managed Responses summary operation after replay-scope rejection (#349). Preserve visible messages/tool pairs, native directive, route/cap, cancellation, source history and single transactional commit; no automatic retry, hidden settings change or live execution.
- Show safe allowlisted background-compaction failure reasons through bounded native Error cause chains rather than only a generic failure. Unknown causes remain explicit and private.
- Keep ordinary/manual/automatic compaction and chat continuation consent independent; installation alone neither selects an engine nor runs recovery.

## 0.4.0-alpha.120 (prepared)

- Let explicitly account-bound model preparation, native dispatch and subsequent turn steps continue during global selector switching, fixing `COPILOT_ACCOUNTS_BUSY` from the overly broad acquisition fence (#344).
- Keep unbound/global request fences, credential authorization/removal/sign-out protection, pinned-record leases, cancellation, route checks and original turn accounts. No automatic retry, message replay, fallback account, history rewrite, Core change, installation or restart.
- Exercise native Responses, Chat Completions and Anthropic dispatch while switch preflight is pending, then verify that the next turn adopts the confirmed new default.

## 0.4.0-alpha.119 (prepared)

- Show Models global account metadata before background identity-name hydration, keeping Switch available when metadata and route/activity evidence allow it (#342). Hydration never authorizes a switch and late results cannot undo a confirmed change.
- Capture the latest parent callback without rebuilding the account card lifetime, avoiding duplicate identity ensures and lost switch responses.
- Overlap fresh switch identity/model validation under one bounded mutation fence. Both must succeed before CAS; failures cancel and drain sibling work before releasing the fence. Preserve credential identity, membership, route/activity, revision and post-commit checks.
- Keep Session account/Follows global default ownership, real running turns, native directory transport and account-bound discovery unchanged. No live latency claim, automatic write retry, Core changes, installation or restart.

## 0.4.0-alpha.118 (prepared)

- Reuse confirmed model-preference CAS readback instead of describing all settings a third time for successful Exclude/Restore/High cost saves (#339).
- Keep pending and confirmed preference edits across equivalent parent snapshots. Account metadata can update independently without discarding a shared-preference save or restoring an old availability snapshot.
- Allow distinct model rows to wait in a bounded, mounted-only queue, while issuing only one narrow write at a time. Show Saving/Waiting explicitly; cancel unsent edits after unconfirmed outcomes or scope replacement and require saved-settings Retry, never automatic write replay.
- Native Models `llm/listProviders failed: Failed to fetch` remains a separate Host/gateway transport limitation, not evidence of forced account discovery. No Core changes, transport workaround, live latency claim, installation or restart.

## 0.4.0-alpha.117 (prepared)

- Separate confirmed Session account selection from quota loading (#337). Preserve correctly attributed quota for follow-mode-only changes without duplicate account or quota reads.
- Reuse the strict save response, immediately restore account controls and focus, and load a different account's quota independently. Slow or failed quota cannot undo a confirmed save; newer selections and invalidations revoke late responses.
- Keep continuation consent, post-consent revision reread, native CAS, account isolation and running-turn ownership unchanged. No forced model refresh, Core changes, live calls, installation or restart.

## 0.4.0-alpha.116 (prepared)

- Add immediate, cross-account High cost marking to existing model-preference rows through strict narrow Remotes and public SettingsForms CAS/readback (#333).
- Keep cost orthogonal to task difficulty and supplier category. Use positive weights 1/0.2 and finite previous-model multiplier 1.5 within the fitting category, preserving exclusion, capacity, fallback and admitted-turn ownership. Auxiliary classifiers separately prefer eligible unmarked Lightweight models.
- Expose bounded current-Session Host-lifetime allocation observations through native Agent lookup and the existing selection dialog, with candidate opportunities, conditional expected selections, actual selections and local JSON export. No automatic upload, durable history, quality/billing inference or native Usage changes.
- Require the previous Auto review in task plans, Agent contract and PR evidence; explicitly record missing live data and post-delivery owner/sample triggers (#332). Record controlled advisor requirements without shipping unverified extra calls.
- No Core changes, automatic installation, restart or live model calls for validation.

## 0.4.0-alpha.115 (prepared)

- Default automatic segmented recovery on in the explicitly selected compaction recovery engine (#330). Keep fitting summaries native; handle known oversized input or one typed summary context-limit failure inside the same Core transaction.
- Bound each recovery invocation to 16 physical calls including the first rejected attempt; preserve cancellation, balanced tool pairs, source/shrink checks, native retry ownership and output caps. Never escalate timeout/408/auth/quota/network failures or commit partial summaries.
- Preserve native `auto: false` and add `automaticRecovery: false` for automatic-segmentation opt-out. Bind summary capacity proof and dispatch to the initiating Agent's account; omit incomplete aggregate accounting after an initial failure.
- Document explicit same-scope engine migration and rollback without overriding custom engines, presets or live profiles. No Core changes, automatic installation or restart.

## 0.4.0-alpha.114 (prepared)

- Simplify the Chat account menu to configured accounts only. Move Follow global default into a separate checkbox and keep account addition in Models (#328).
- Freeze the current effective account when following is disabled; restore inheritance when enabled. Explicit account choices, including the current default, remain Session overrides.
- Preserve continuation consent, cancellation, revision-checked saving, running-turn ownership and quota isolation; restore focus after controls become enabled. Record the approved interactive mock and localized experience.
- No Core changes, automatic sends, installation or restart.

## 0.4.0-alpha.113 (prepared)

- Remove the continuation filter's whole-request 16 MiB refusal and recursive payload traversal. Large ordinary tool/image content is preserved; old encrypted reasoning is processed independently (#326).
- Bound reasoning count and ciphertext work, yield during hashing, and recheck request/turn cancellation before atomically establishing the baseline. Await filtering before exact native 408 retry-byte bookkeeping.
- Verify first-step and continuing-step native automatic compaction with Auto, durable in-memory summary replacement, fresh request rebuild and large historical reasoning. Preserve native token admission, disabled-auto/missing-engine behavior, summary failures and retry bounds; do not misclassify processing bytes as token pressure.
- No Core changes, automatic sends, live-history replay, installation or restart.

## 0.4.0-alpha.112 (prepared)

- Back the shared Models/Chat account dropdown's translucent native menu token with opaque Canvas. Underlying settings and quota text no longer bleed through in dark mode (#324).
- Replace CanvasText-based dropdown and Credits shadows with restrained dark elevation in both themes. Preserve account routing, confirmation, continuation consent, keyboard navigation and viewport bounds.
- Add theme regressions covering opacity and elevation; document translucent-token acceptance. No Core changes, live installation or restart.

## 0.4.0-alpha.111 (prepared)

- Retain verified saved-account display names beyond the ten-minute revalidation interval in bounded Host memory. Models and Session Credits resolve missing inactive account names without switching accounts; credential changes, removal and failed verification still invalidate names (#322).
- Capture identity for the frozen admitted account and non-blockingly ensure missing identity once per active turn. Preserve the first verified name, require native delivery for execution evidence, and reject late/aborted/completed-turn enrichment. Refresh the account footer at native completion.
- Keep existing strict Remote descriptors, credential ownership, model-access validation, history and Usage unchanged. No persistent name store, Core changes, live installation or restart.

## 0.4.0-alpha.110 (prepared)

- Replace searchable account-switch forms with one compact anchored dropdown in Models and Chat: current-choice checkmark, bounded internal scrolling and Add account footer (#320).
- Separate saved-account reauthorization/removal from switching. Preserve global confirmation, explicit-off continuation consent, fresh revision readback, cancellation and admitted-turn ownership; selecting never sends or retries.
- Record the approved dropdown mock and keyboard/mobile behavior. No Core changes, credential migration, live installation or restart.
- Unify normal continuation and failure guidance around the persistent Session policy. Remove duration radios and next-turn-only actions; when off, disclose loss and offer Enable/Cancel, when on, show diagnostics without repeated authorization. Existing temporary recovery contracts remain compatibility-only; their evidence expiry does not expire the persistent policy.
- Omit the nonfunctional Chat management entry and unavailable-navigation paragraph when no public Models navigation callback exists; keep full management in Models.

## 0.4.0-alpha.109 (prepared)

- Record the approved synthetic account-management mock and unify current-account/Switch interactions in Chat and Models. Search bounded account lists, add without selecting, and retain guarded full management inside one Models Manage disclosure with shared exact-ID model preferences (#318).
- Add persistent Session on/off/default policies, a creation-time global default for new unseeded Sessions, reversible next-turn consent and cancel-safe explicit-off account-switch confirmation. Existing/unknown/seeded histories are not enrolled retroactively. Authorization never sends or retries.
- Filter bounded pre-turn encrypted reasoning and embedded summaries through the published native Responses adapter; retain current-turn tool-loop reasoning, visible messages, native retries and durable history. Expose persistent/next-turn controls after exact replay failures; keep the native manual retry action.
- Preserve account/default/continuation settings revisions, dark/light native control readability, cancellation and stale-response fences. The pinned Core lacks a public Models deep link, so Chat provides manual navigation; no Core patch, credential copying, second transport or live installation.

## 0.4.0-alpha.108 (prepared)

- Align context evidence and replay recovery with native secondary typography throughout, including explanations and controls. Use the public full-width input dock above the composer instead of the non-wrapping statistics row (#315).
- Replace verbose replay-scope failure text with concise account/connection guidance, explicit recovery consent and a new-conversation alternative. Retain bounded sanitized dispatch counts separately in Host diagnostics; do not infer which encrypted item failed.
- Keep recovery default-off and lossy, with unchanged duration, expiry, native Send/Retry and stored-history semantics. No automatic replay, account reset, history deletion or Core change.

## 0.4.0-alpha.107 (prepared)

- Present an in-flight multi-account device authorization as progress with the verification URL, one-time code, copy action and cancel together; distinguish Host-confirmed post-OAuth identity/model verification from pending authorization. Adding an account never changes the global default.
- Keep technical account diagnostics secondary, show only supported blocker evidence, and clarify that account-information refresh is identity-only.
- Show turn identity only when captured for that turn and replace opaque unknown account IDs in Credits selectors with localized readable authorization labels (#313).

## 0.4.0-alpha.106 (prepared)

- Show truthful failed-turn model evidence inside the existing Auto/Manual info dialog, with selection reasons disclosed below (#310). Preserve successful same-turn models/providers and explicit incomplete failed-attempt attribution without changing native Usage.
- Add bounded public same-turn request-header evidence as Requested model, never dispatch, execution or billing proof. Missing/invalid evidence remains unknown; read-only Retry stays on the viewed Session/turn. No new footer button, durable events, history writes or entry for turns lacking a closing assistant-actions anchor.

## 0.4.0-alpha.105 (prepared)

- Renew expired account identity from visible Models and Credits through nonforcing, account-scoped ensure reads. Fresh ten-minute cache avoids requests; concurrent consumers share one bounded request and failed renewals retain a thirty-second cooldown (#309).
- Revoke pending identity on credential changes, selection changes and disposal, rejecting late results even when credentials retain the same bytes. Explicit account switching/reauthorization still validates fresh identity.
- Settle account-coherent Credits independently of slow identity renewal. Preserve Session account choices, running-turn pins, quota freshness semantics and metadata-only status reads.
- Add strict additive global/Session ensure Remotes and sanitized timeout, TLS, network, authentication, rate-limit and HTTP diagnostics. No authenticated provider calls, installation or restart are implied by synthetic evidence.

## 0.4.0-alpha.104 (prepared)

- Select an already authorized account inside Credits for this Session's subsequent turns, or follow the Models global default. Explicit same-as-default choices remain overrides; running turns keep their frozen account (#305).
- Isolate managed account metadata, OAuth resolution, Auto assessment, request recovery, quota and search proofs through the published native adapter. Default or Session preference changes do not redirect running steps, retries or search; pinned accounts remain protected from reauthorization/removal.
- Add Account beside native turn Usage using captured ordinary-request evidence. This bounded Host-lifetime evidence becomes unknown after restart or eviction; no durable events, history changes, inferred billing receipts or subagent totals.
- Persist only opaque Session preferences through native path-level SettingsForms CAS. Reuse existing Credits/turn popover styles and explicit Session lookup with separate strict Remotes; preserve native account compatibility and credential ownership.

## 0.4.0-alpha.103 (prepared)

- Reevaluate transient account BUSY failures from current leases, authorization and managed Agent activity on status reads instead of retaining a stale rejection after work ends (#303).
- Keep active work blocked and preserve missing evidence, native-route restrictions and uncertain-commit errors. Status recovery does not refresh credentials, authorize another account, switch models or write settings/history.

## 0.4.0-alpha.102 (prepared)

- Read official rc.2 SettingsForms values without requiring the retired `get()` method, fixing an unconditional `COPILOT_ACCOUNTS_EVIDENCE_INCOMPLETE` account-switching blocker (#301).
- Exercise the production route diagnostic in native account persistence and restart coverage. Preserve unknown-evidence rejection, managed-only eligibility, activity fencing, target validation and selector CAS; no credentials, history, model-selection or Core changes.

## 0.4.0-alpha.101 (prepared)

- Accept GitHub Enterprise Managed User login names, including underscore-separated enterprise suffixes and setup admin names, in both Host identity normalization and strict Client Remote decoding. Keep bounded JSON, numeric identity, credentials and account-switching safeguards unchanged.

## 0.4.0-alpha.100

- Add independently authorized GitHub Copilot accounts through official OAuth and the existing DSH credentials service (#297). Preserve the canonical compatibility account; inactive-account refresh remains lazy and record-bound.
- Manage, confirm switches, remove inactive authorizations and reauthorize the same identity in Models. Managed-only evidence, target preflight, activity fencing and path-level selector CAS prevent unsafe switches; no history, selected-model or default rewrites.
- Show the current GitHub identity read-only in Credits details, paired with account-bound quota evidence. Clear mounted readings during account changes and reject late responses; quota snapshots are not proof of cross-app AI-credit aggregation.
- Preserve existing Remotes and add a separate strict account namespace. Native gateway, adapter and synthetic on-disk restart tests complement the required full CI; no live OAuth, installation or loaded Desktop success is implied.

## 0.4.0-alpha.99 (prepared)

- Enforce Auto assessment's single monotonic deadline at preparation, native request and result boundaries even when a delayed timer has not fired (#295). Dispose the assessment timer and listener on settlement; preserve cancellation, proof revocation and unknown-demand fallback.
- Prefer eligible supplier Lightweight classifiers advertising reasoning-off, with deterministic ID tie-breaking. Send off only with matching published native support, without latency guesses, another classifier or retries.
- Explain the fitting category pool and continuity separately from semantic model merit. Preserve previous-model policy, turn freezing, native Usage and history; no cross-turn cache or Core changes.

## 0.4.0-alpha.98 (prepared)

- Retain owner-explicit Auto intent through a strict public Session projection when a native virtual request header consumes pending selection (#293).
- Preserve intent across concrete execution headers and cold replay; later fixed/other-provider choices replace it for future turns. Admitted Auto requests keep their route through late picker changes.
- Ignore copied fork/child prefixes as owner-explicit evidence; keep native pending/parent-follow precedence and named missing/invalid diagnostics. No Core changes, new durable events, settings/history rewrite or fabricated historical reasons.

## 0.4.0-alpha.97 (prepared)

- Add request-scoped public native body-write/header timing and optional TLS ALPN/Node buffer observations to exact verified Copilot request-body timeout diagnostics (#291).
- Keep unavailable, ambiguous and bounded-work evidence explicit; dispose subscriptions when Fetch settles. Local submission is not upload duration, kernel ACK or supplier receipt.
- Preserve Fetch arguments, Response/errors, payload/replay/history, connection/proxy/dispatcher and native retry behavior. This supplies future failure evidence, not a demonstrated supplier 408 cure.

## 0.4.0-alpha.96 (prepared)

- Surface verified replay-recovery evidence automatically when an eligible Session opens or its native turn settles; ordinary conversations remain uncluttered (#289).
- Add explicit next-matching-turn or bounded Session consent, defaulting the choice to one turn. All native steps/retries share that turn's authorization, which is consumed at turn end. Confirmation never sends or retries a message.
- Preserve exact-item/proof guards, old Remote identities and native history ownership. Add native gateway and desktop/mobile component coverage, local dismissal, explicit read failures and expiry updates. This is not a supplier 408 fix.

## 0.4.0-alpha.95 (prepared)

- Preserve native usage and chunk order before restoring dispatch-local byte-idle or replay errors (#285). Previously the owned error could be thrown before the SDK's terminal usage, discarding both failed-zero and real nonzero samples.
- Prove the correction with unchanged native Responses and Anthropic timeout regressions. Preserve structured errors, cancellation, retry policy and wire/history ownership.
- Document the separate native failed-zero context-pressure limitation and retry backoff timing. This is an accounting correction, not a cure for supplier HTTP 408 or a replacement native context meter; loaded Desktop acceptance remains unverified.

## 0.4.0-alpha.94 (prepared)

- Count native Responses tool-output image spans under `function_call_output.output[]` in bounded timeout diagnostics (#287), rather than misclassifying them as remaining history.
- Preserve unknown output shapes, exact original byte spans, total-byte partitions, native image budgets, history/replay, failure classification and transport. Old stored diagnostics are not rewritten; this corrects evidence, not recurring supplier 408s.

## 0.4.0-alpha.93 (prepared)

- Add default-off, explicit session replay recovery after verified Responses scope rejection. Confirming the disclosed loss omits only matching old encrypted items and their summaries on later requests; stored history, tool pairs and new reasoning remain unchanged.
- Bind recovery to native Agent lookup, initiating request signals, model/account proof and bounded Host-lifetime evidence. Do not automatically retry or treat this as a 408 fix.

## 0.4.0-alpha.92 (prepared)

- Match the historical context disclosure title to neighboring composer statistics using the existing secondary font-size/line-height tokens, normal weight and tertiary label color (#283).
- Preserve native disclosure interaction, localization, historical evidence, context metering and Usage ownership; this changes presentation only.

## 0.4.0-alpha.91 (prepared)

- Prevent known continuing-step managed input pressure before native model-attempt admission through the public `agent/pre-step` seam (#280), using the initiating Agent's current compaction service and one native transaction.
- Require a committed owned route and a proven absent pending model change. Respect disabled auto, overflow policy, cancellation and native failures; retain final converted admission and stream-pressure fallback.
- Prove the before/after accounting boundary with the unchanged rc.2 AgentLoop: successful early reduction removes the unsampled pressure attempt and preserves complete native two-step Usage. First-step/pending selections, new prefix growth and final hard refusals remain limitations; no historical totals, usage samples, retry counters or model selections are rewritten.

## 0.4.0-alpha.88 (prepared)

- Capture bounded classifier model, total elapsed/budget, adapter-start, first-text, native finish and validation milestones in immutable ephemeral Auto turn evidence (#272). No prompts, raw outputs, credentials, replay or usage are recorded.
- Reduce auxiliary classification to 128 output tokens with compact demand/fixed-signal JSON. Request off reasoning only when supplier metadata and the published prepared-model capabilities agree; unsupported controls retain native policy.
- Explain semantic timeout as unknown-demand preference fallback and expose auxiliary milestones inside the existing bilingual disclosure. Preserve the 8s end-to-end deadline, cancellation/revocation, omitted-context guards and single attempt; no longer timeout, retries, guessed model-health ranking or measured improvement claim.

## 0.4.0-alpha.87 (prepared)

- Remove managed terminal-zero usage filtering so native failure/cancellation samples remain available to Core's shared turn and cumulative accounting (#270).
- Retain unreliable failed-zero classification only in the independent historical context disclosure. Native zero pressure remains a known limitation, not a reason to remove shared usage or invent supplier receipts.
- Add native Responses zero/Anthropic nonzero cancellation and unchanged Core whole-turn regressions. Preserve errors, cancellation, retry and old histories; genuinely missing usage/lifecycle and timeout limitations remain explicit.

## 0.4.0-alpha.86 (prepared)

- Enable bounded semantic Auto assessment by default for locally unknown tasks at the user's explicit request (#267). Preserve existing explicit false settings and document the opt-out.
- Apply the same default to unset managed-route settings, while retaining local known-task short-circuiting, one auxiliary call per admitted turn, strict output, timeout/cancellation/account guards and omitted-context protection.
- Disclose additional supplier charges outside native Chat Usage. Default rollout does not claim labeled-corpus calibration, change native history or perform profile installation/restart.

## 0.4.0-alpha.84 (prepared)

- Add bounded numeric composition of the actual final request for verified Copilot `408 / user_request_timeout`, distinguishing conversation, tool definitions, protocol-owned system/instructions and residual framing (#263).
- Within conversation, count structural image blocks and opaque replay as disjoint wire-byte subsets without decoding or reporting their content. Missing, unsupported, malformed and work-limited evidence remains explicit.
- Capture per-dispatch fetch-to-response-header elapsed time before clone observation, honestly labeled as round trip rather than upload duration. Preserve native payload/response bytes, failure classification, retry, cancellation and credentials; no automatic settings change, trimming, compaction or model switch. Diagnostics guide explicit mitigation, not a claim to cure recurring 408.

## 0.4.0-alpha.83 (prepared)

- Reduce avoidable Auto uncertainty through bounded difficult-task continuation and isolated fenced mechanical-transform recognition (#262); preserve unknown for new, incomplete and ambiguous work.
- Prioritize current and preceding user requests in the bounded semantic projection, preserving complete JSON rows, chronological order and omitted-context downshift protection.
- Call the optional semantic experiment only for locally unknown demand. Explain local rule coverage separately from absent conversation context; retain off-by-default semantics, category policy and native turn ownership.

## 0.4.0-alpha.82 (prepared)

- Explain missing native Turn Usage on completed Copilot replies through a plugin-owned read-only conversation projection and a compact, keyboard-accessible footer disclosure (#259).
- Distinguish the exact recorded local pre-dispatch input-budget block, other settlements without usage, and incomplete history. A recovered turn can contain reported successful steps without a provable whole-turn total.
- Preserve native Usage when complete; do not fabricate zero usage, aggregate partial totals, change history or replace compaction/retry ownership. Record the observed plugin/Core integration gap and its limits.

## 0.4.0-alpha.81 (prepared)

- Route Auto through current supplier Powerful/Versatile/Lightweight categories and contextual task evidence instead of advertised-capacity bands (#258). Preserve hard input/image/exclusion/account admission and native no-fit recovery.
- Use Lightweight for isolated greetings even with Intelligence, retain capable targets for short hard work, prefer suitable previous-model continuity, and distribute only equal-category candidates.
- Explain the actual captured turn choice, category fallback and continuity/tie-break in the footer; old records explicitly lack detailed reasons rather than displaying generic reconstructed text.
- Add an off-by-default bounded semantic-assessment experiment through the existing native adapter. Strict output, omitted-context conservatism, cancellation and diagnostic fallback remain; extra calls add latency and supplier charges outside native Chat Usage. Synthetic tests do not establish calibrated accuracy or GitHub-private parity.

## 0.4.0-alpha.80 (prepared)

- Observe real HTTP/SSE byte progress on managed requests, retaining the original five-minute byte-idle bound while allowing at most ten minutes without a native assistant chunk (#253).
- Preserve native SDK parsing, exact stream bytes, caller cancellation and retry ownership; endless heartbeats remain bounded and explicit WebSocket/auto transport keeps native behavior.
- Add separate managed-chat timeout/opt-out settings and a configurable native image-request budget with the unchanged 20 MiB default. No hidden history trimming, automatic model switch, extra retry or claim to cure HTTP 408.
- Reproduce heartbeat-only semantic timeouts and verify real late output, actual byte stalls and cleanup through unchanged native adapters.

## 0.4.0-alpha.79 (prepared)

- Bind retained turn selection reads through the public `TypertRemoteService` and `@Remote get`, fixing the Host registration missing from the alpha.76 Client-only correction (#254).
- Cover actual Client-to-Host calls in source-discovery and strict modes, including Auto/Manual, missing evidence, missing/denied identities and unload; preserve lookup checks and the existing bounded decision store.

## 0.4.0-alpha.78 (prepared)

- Optimize individual Exclude/Restore saves with a strict preferences-only Remote response, avoiding credential/account-status reads and live-session scans (#252). Keep single-row immediate persistence, CAS conflicts, invalidation and failure recovery; no batch UI.
- Permit exclusion of selected models without rewriting Session/default selections. Preserve already admitted native turns through tool steps and retries, reject excluded models on new turns, and retain account/token/metadata/cancellation guards.
- Native configuration serialization, file locks and Loader synchronization still gate save completion; no live latency threshold or loaded Desktop upgrade is claimed.

## 0.4.0-alpha.77 (prepared)

- Resolve automatic compaction pressure and Auto recovery availability from the initiating Agent's preset through the existing public service lookup (#248), including Desktop's isolated compaction groups.
- Never borrow global recovery when a bound preset has no engine; preserve disabled/zero-retry policy, native transactions, cancellation, and manual-only segmented recovery. No new command, timeout reclassification, Core change, or automatic model switch.
- Cover concurrent enabled/disabled/absent preset engines with unchanged official rc.2 AgentLoop, durable summary/rebuilt-request and cancellation evidence; add the frozen preset dependency closure to both required CI and release gates.

## 0.4.0-alpha.76 (prepared)

- Fix fresh master/lead Auto footer reads rejected by the native Client gateway when an ambient agent context reduced the explicit two-argument call to one (#249). Preserve native Host lookup and strict codecs; do not substitute the ambient Session.
- Distinguish failed selection reads from successfully read missing evidence. Add a bounded, explicit same-turn Retry without rerunning inference or leaking raw errors.
- Reproduce the old descriptor failure and verify bound/unbound calls through the unchanged pinned Client gateway.

## 0.4.0-alpha.75 (prepared)

- Add safe, actionable managed `COPILOT_REQUEST_BODY_TIMEOUT` guidance for the exact observed HTTP 408 request-body timeout, including final JSON UTF-8 bytes when observable (#246).
- Preserve native failure classification, retry metadata, payloads, cancellation and credential ownership; no new retry, timeout change, automatic compaction, hidden trimming or model switch.
- Share the existing bounded clone-only response observer with replay-scope classification and cover all three native HTTP protocols, unknown/oversized/stalled replies and concurrent dispatch isolation. This is diagnostic/recovery guidance, not a claim to eliminate upstream timeouts.

## 0.4.0-alpha.74 (prepared)

- Add `/copilot-compact [status|cancel]` to the explicitly selected recovery engine when native commands/jobs are available (#244).
- Acknowledge a Session-owned background job promptly instead of holding Desktop's unary command request past its response-header timeout. Preserve native `/compact`, maintenance locks and compaction transactions.
- Deduplicate active starts, cancel and drain on teardown, and collect native settlement without waking the model or resuming a Goal. Admission is not completion; failed summaries retain their native diagnostics.

## 0.4.0-alpha.73 (prepared)

- Prevent managed Copilot failure/cancellation terminal zero-usage samples from resetting native context pressure; preserve successful zero and real nonzero usage (#242).
- Add a strict plugin-owned historical context projection and an additive composer disclosure for replayed failed-zero readings. Last input-plus-cache samples are historical evidence, never current occupancy or inferred percentages.
- Revoke old samples on route changes, compaction, surface replacement and invalid attribution. Keep the Core meter, account Credits, durable history, retries and compaction ownership unchanged.

## 0.4.0-alpha.72 (prepared)

- Retain the mounted account controller and model metadata across exclusion-driven Models rerenders by capturing the native traced Copilot Remote once per UI registration (#240).
- Avoid redundant account status and model-discovery work on provider/footer/section rerenders; preserve real registration teardown, credential invalidation, selection locks and exclusion CAS.
- Add regressions with fresh Remote proxies and a blocked second status read, plus exact published-gateway namespace identity evidence. No Core changes or Desktop install/restart.

## 0.4.0-alpha.71 (prepared)

- Decouple the Auto selection footer from optional conversation projections and wait for its exact Remote namespace (#238).
- Use native completed-turn evidence to show retained Auto/Manual records when projection data is unavailable; keep incomplete attribution explicit without guessing historical selections or changing native Usage.
- Cover cold/incremental native assembly and session-scoped rendering, projection failures, pending dependencies and invalid completion evidence. Live Desktop recovery still requires loaded-version verification.

## 0.4.0-alpha.70 (prepared)

- Require image-capable Auto candidates for retained historical user/tool images after text-only continuations; honor native image offload markers (#236).
- Validate actual native-projected image MIME against explicit account format evidence before managed dispatch, with request-local diagnostics and no image rewriting, model switch or additional retry.
- Document why durable attachment formats and filenames cannot prove outgoing MIME, and retain the original service-side rejection as unverified rather than declaring Grok text-only.

## 0.4.0-alpha.69 (prepared)

- Add an explicit, opt-in manual compaction engine for compressible already-oversized managed Copilot histories. It uses a bounded public summary hook and native transactional replacement without changing the default compaction service. Include account-proof and failure boundaries in the recovery design.

## 0.4.0-alpha.68 (prepared)

- Add one **Follow parent model** control in plugin settings. Enable once for existing and new supported Copilot subagents and Team mates; no Session IDs or per-child setup (#234).
- Preserve active turns, child-owned manual selections and independent child Auto decisions. Keep legacy explicit bindings without hidden migration.
- Record requirements, implementation plan and a synthetic screenshot of the actual settings component; use narrow settings CAS and preserve unsaved search drafts.

## 0.4.0-alpha.66 (prepared)

- Add explicit native child/direct-parent model-follow bindings, disabled by default. Enrolled children follow fixed selections on their next turn or independently resolve the parent's Auto preference against their own context (#229).
- Preserve in-flight turn routing, explicit child selections, native histories, defaults, credentials and permissions. Unknown lineage, unsupported children and missing parent evidence fail with named diagnostics rather than guessed models.
- Record exact-source inheritance research, configuration boundaries and validation limits. Native creation labels are not rewritten, and existing children are never automatically enrolled.

## 0.4.0-alpha.65 (prepared)

- Fix Auto input undercount by using Core's public TokenMeter instead of passing Core messages to pi-ai's incompatible estimator and swallowing its errors (#230). Include assistant reasoning/tool history and retain native current-surface/tool-envelope measurement as a conservative floor.
- Fail Auto explicitly when native measurement is missing or invalid; fixed model selection remains available. Recognize native compact-checkpoint provenance without changing messages or same-turn routing.
- This is a preventive input-fit fix, not recovery of already oversized manual summaries. The independent summary-input overflow investigation remains open in #228; no chunking, alternate summarizer, history deletion, or extra retry loop is introduced.

## 0.4.0-alpha.64 (prepared)

- Omit only explicitly empty completed reasoning shells from managed Responses outgoing payloads, without changing durable history, opaque encrypted content, public summaries or tool call/result pairing (#226).
- Preserve fail-closed handling for partial, unknown and reference-dependent replay. Existing HTTP-408 retry snapshots may reuse the same omitted shell only when the entire original request and retry scope match; no new retry loop or model switch is introduced.

## 0.4.0-alpha.63 (prepared)

- Restore the completed-reply Auto preference and recorded-reason disclosure on official Desktop by reading ChatNodeStore's public iterable `values()` instead of requiring a JavaScript `Map` (#222). Retain Map support and diagnose an unavailable collection once without querying another turn.
- Preserve exact Session/turn lookup, stale-response isolation, unknown/manual evidence rules, native Usage model display, and existing selection policy. No history migration or Core changes are required.

## 0.4.0-alpha.62 (prepared)

- Preserve model preferences through Client authorization decoding and make hidden exclusions a native live Config field, fixing both invisible controls and rejected settings writes (#223).
- Add All/Enabled/Excluded filtering, searchable model rows, explicit selected-model locks, status-only Retry and named read-only diagnostics. Keep discovery details separate and reject stale action results after account changes or unmount.
- Add shared-account-to-Manage regression coverage and unchanged native SettingsForms CAS/fiber/persistence evidence. No Core, credentials, histories or native picker layout are changed.

## 0.4.0-alpha.61 (released)

- Preserve the exact normalized managed Responses request across Core's freshly prepared retry attempts only after the previous request actually received HTTP 408. Short-lived state is scoped to the original turn signal, Session, model and account proof, and cleared on new step/turn end. Retry-only item references or incomplete ID-bearing items must identify matching complete prior items without contradictory fields, and all other payload and transcript bytes must agree; changed inputs, concurrent requests and cold resumes fail closed (#217).
- Keep native retry policy, SDK transport, durable replay, credentials, and model selection unchanged. A synthetic native-SDK regression covers two 408 responses followed by a reference-only third attempt; real account acceptance and Desktop installation remain unverified.

## 0.4.0-alpha.60 (released)

- Add exact account-model exclusions under **GitHub Copilot → Manage → Model preferences**, with local search, visible/excluded counts, explicit **Exclude/Restore** actions, and retained rows for excluded IDs temporarily absent from account metadata (#192).
- Remove excluded IDs from the managed picker, every Auto candidate pool, aggregate Auto modalities, hosted-search route facts, and request-budget admission. Stale picker or direct requests fail with `COPILOT_PREVIEW_MODEL_EXCLUDED`; Auto fails closed when no eligible model remains.
- Protect the current fixed managed selection using public default and live Session projection/request-header evidence. Exclusion writes use path-level settings CAS and never rewrite history, switch a Session, mutate the account grant, or change Core's flat picker layout.

## 0.4.0-alpha.59 (released)

- Fix unavailable Web search routing on official rc.2 by exposing the plugin's live routing fields through native Config projection (#216). Retain narrow CAS writes, separate legacy override reset, ordinary safety configuration and live snapshot consumption without remounting.
- Replace the manually populated settings test double with a disposable native Loader/ConfigEditor/SettingsForms fixture covering projection, save, conflict rejection and restart persistence.

## 0.4.0-alpha.58 (prepared)

- Add compact Auto preference and expandable recorded reasons after the native reply time through the public assistant-actions slot; explicit fixed selection shows Manual, absent evidence shows Selection unknown. Remove the separate Model details candidate and repeated model name; actual models stay in native Usage.
- Keep new selection evidence in a bounded Host-lifetime store with native agent-scoped lookup, not incompatible durable events. Restart, disposal and eviction lose this evidence; compatible historical Auto records remain readable. Native Usage aggregation and its missing-route behavior are unchanged.
- Preserve plugin-owned credential invalidation and disposal reasons as specific `ABORTED` diagnostics, without changing transport retries, timeouts or partial output.
- Add offline native-SDK regressions distinguishing HTTP 408, transport termination, missing Responses terminal events, true cancellation and zero-usage measurement limits. These changes do not claim to fix upstream timeouts, disconnects or native context-meter resets.

## 0.4.0-alpha.57 (released)

- Keep plugin-owned rc.2 lifecycle guidance visible before disable, removal, or upgrade, because the plugin UI is unloaded before Desktop can report dependent Web entries pending on a service (#185).
- Document that an already-Off plugin with only `pending (waiting for service: …)` dependent entries requires a full Desktop restart rather than repeated toggling, without reclassifying other native failures.
- Include the bounded rc.2 Web lifecycle characterization in the published package.

## 0.4.0-alpha.56 (released)
- Pin `undici` to 6.28.1 to resolve the observed 6.29.0 installation failure in the configured package mirror (#212). Keep the lockfile registry-neutral and preserve the quota-only TLS dispatcher; this does not establish full Desktop installation or activation.
## 0.4.0-alpha.55 (prepared)

- Use a quota-only, reusable TLS-verified dispatcher with Node default and system CA roots for the GitHub Copilot usage endpoint (#209). This removes reliance on launcher inheritance of `NODE_USE_SYSTEM_CA` for quota requests, without changing Core, sign-in, model/search transport or global trust.
- Show an explicit unavailable diagnostic if system trust cannot be read or the dispatcher cannot be created; preserve injected fetch isolation and close the dispatcher on disposal.

## 0.4.0-alpha.54 (prepared)

- Stop writing optional Auto attribution events that official DSH 0.2.0-rc.2 cannot mark ignorable, preventing subsequent Session history reads from failing (#204). Auto routing, durable virtual selection, and Core's actual model provenance are unchanged; new turns omit the plugin-specific attribution footer.
- Add an explicit source-checkout recovery command using the unchanged official v4 codec. It validates a detached repaired copy and preserves a byte-exact original backup, without replacing live histories or restarting Desktop.

## 0.4.0-alpha.53 (prepared)

- Fix Auto model concentration and context budget overflow by evaluating input fit as a hard routing condition before preference and distributing soft preferences across candidate bands with deterministic turn seeding (#199).
- Exclude candidates whose hard input limit cannot admit estimated turn input, preventing `COPILOT_CONTEXT_BUDGET_EXCEEDED` failures.
- When no candidate fits, route to the largest input capacity model and trigger compaction pressure on compressible history.
- Distribute soft preferences across upper/lower/center candidate bands via deterministic in-memory hash of `sessionId:turn`, preventing top catalog models from monopolizing all Sessions while freezing selections across retries and steps within the same turn.

## 0.4.0-alpha.52 (prepared)

- Place Copilot Auto model attribution after the settled turn clock on the same footer row, and reveal it only on hover or keyboard focus, matching usage and time chrome.

## 0.4.0-alpha.51 (prepared)

- Fix web search routing settings save by reading and writing `searchRouting` under the existing `github-copilot` settings namespace, avoiding the unexported `installSection` limitation in official `@deepseek-ai/dsh-settings@0.2.0-rc.2` (#195).
- Coordinate CAS revisions between web search routing and legacy `searchModel` resets within the shared `github-copilot` namespace while preserving unsaved drafts.
- Remove fake separate namespace and `installSection` mocks from synthetic test fixtures and align contracts.

## 0.4.0-alpha.50 (prepared)

- Add a visible restart banner in `WebSearchRoutingCard` when the routed search service composition is unready, guiding users to cold-restart Desktop (#196).
- Streamline the plugin details configuration page by removing the internal `HostedSearchSettingsCard` debugging form from `plugins.bundle.config`, leaving only `WebSearchRoutingCard`.
- Add guidance on `NODE_USE_SYSTEM_CA=1` for Copilot Quota TLS verification when using network accelerators or local proxies like Watt Toolkit (Steam++).
- Update documentation on cold-restart requirements for `cordis.patch.yml` service recomposition and Windows system CA trust.

## 0.4.0-alpha.49 (prepared)

- Add bounded soft capacity preferences to Copilot Auto model routing (#192).

## 0.4.0-alpha.48 (prepared)

- Keep the managed Copilot Auto model selected across turns when inherited as a new Session's default; record its durable intent before the first real-model request header and restore the virtual route on later turns (#189).
- Preserve explicit fixed-model selections, real request headers and per-turn Auto decisions without changing existing Sessions with a recorded concrete route.
- Supersede unpublished alpha.47 after its immutable pre-created tag failed the protected exact-annotation check; no alpha.47 GitHub Release or npm package was created.

## 0.4.0-alpha.47 (publication blocked)

- Publication stopped after packing and checksum verification because the immutable pre-created tag's annotation did not satisfy the protected exact-message check.
- The alpha.47 tag remains unchanged and is not reused; its prepared Copilot Auto selection fix is carried by alpha.48.

## 0.4.0-alpha.46 (prepared)

- Distinguish known TLS certificate-verification failures from other Copilot quota network errors without revealing provider errors or disabling certificate validation (#186).
- Keep unavailable quota details readable: omit empty large-value columns and budget placeholders, use an opaque popover background, and bound long values within the dialog.

## 0.4.0-alpha.45 (prepared)

- Add a fixed, allowlisted latest-observed authorization milestone to failed sign-in diagnostics without inspecting or retaining rejected values, provider responses, credentials, prompts, notices, or nested causes (#178).
- Clear the ephemeral milestone on cancellation, success, sign-out, and each new attempt; distinguish observed request, prompt, and notice progress from an inferred failure cause.
- Document the exact rc.2 hot-removal boundary: removing the routing bundle after activation can strand the public Web service isolate until restart, while the native manager already marks existing-package upgrades as restart-required. Do not remove and re-add the package to bypass that boundary.
- Supersede unpublished alpha.44 after its immutable tag failed the protected annotation check; no alpha.44 GitHub Release or npm package was created.

## 0.4.0-alpha.43 (prepared)

- Put Web search routing and Copilot hosted-search options on the plugin bundle's detail page through the public `plugins.bundle.config` slot (#177).
- Keep sign-in, account status and model refresh in Models; retain the routing card's Models/section fallback if the bundle slot is unavailable.
- Save routing and hosted-search options independently to their existing namespaces with revision checks, preserving unchanged allowlists and explicit legacy model overrides. No settings, profile or Session is migrated on page open.

## 0.4.0-alpha.42 (prepared)

- Add a plugin-owned virtual **Auto** model to the managed GitHub Copilot route, resolving once per Core turn to a real account model while preserving explicit selections and truthful request provenance (#174).
- Filter image turns by account-verified image capability, keep search independently owned, and preserve native subagent concrete-route inheritance.
- Reuse the existing local request-pressure signal and Core transactional compaction so a smaller-context Auto choice can recover with the same real model and no oversized wire request.
- Record credential-free Auto decisions for a public turn-tail `Auto · actual model` disclosure with an inline explanation, and correct virtual-Auto model-switch guidance before it reaches the model.
- Document the plugin-only MVP and interactive multi-provider mockup. The deterministic capacity heuristic does not claim model quality, latency, price, health, or parity with GitHub's private Auto router.

## 0.4.0-alpha.40 (prepared)

- Sanitize authorization failures into allowlisted begin-stage and post-auth route-repair diagnostics in the existing Remote error field; unknown or legacy arbitrary errors remain generic.
- Stop retaining or logging raw authorization errors, including message, URL, response body, token, device code, and nested cause content; render safe stage-specific next steps.
- Add regressions for cancellation, successful authorization, route-repair failure, nested causes, secret-bearing errors, arbitrary thrown values, and backward-compatible generic Client behavior (#172).
- Diagnostics identify only where the flow failed; they do not explain or resolve the underlying OAuth failure.

## 0.4.0-alpha.39 (prepared)

- Qualify the exact official DSH and signed Windows Desktop `0.2.0-rc.2` peer graph; retain rc.1 as historical evidence.
- Align the managed native adapter with pi-ai `0.87.1` transcript contexts and preserve truthful estimated input admission.
- Compose ordered bundle patch arrays in the read-only installation preflight through the public rc.2 API, with malformed/ordering regressions.

## 0.4.0-alpha.38

- Add official DSH `0.2.0-rc.1` as the current exact compatibility target while retaining the existing baseline pins; use the corresponding public Core packages in development and tagged-source CI.
- Adapt plugin settings reads/listeners to the current public `SettingsForms` descriptor/event API while retaining legacy Core compatibility. Materialize volatile pi-ai provider profiles through their public getter.
- Preserve current first-class tool messages, older nested tool results and Core-owned developer history semantics in the plugin's guarded serializers; retain recursive legacy file detection when the Core predicate does not recognize older nested content.
- Update Remote/Gateway and serialized agent lifecycle regressions to match the published 0.2 contracts, and keep provider routing writes isolated from the Copilot settings namespace.
- Record the pinned official-first API review and qualification boundaries in `docs/official-first-020-rc1.md`. Local tests do not qualify the packaged Windows Desktop runtime, live OAuth/provider calls, or loaded Desktop activation.

## 0.4.0-alpha.37 (prepared)

- Recognize both observed uncoded Responses scope-401 messages, including `input item does not belong to this connection` without `ID`, so that request-local rejection does not retire shared OAuth proof or abort neighboring calls (#164).
- Retain exact message matching, consistent outer/nested envelopes, genuine-auth code/type precedence, HTTP-status and bounded-body checks; do not broaden classification to arbitrary connection text.
- Exercise both variants through the real native adapter for concurrent isolation, same-lease independent dispatches, cancellation, credential reuse and genuine-auth renewal. The fixture reproduces the defect without cron.
- Keep payload normalization, encrypted history, model selection and transport unchanged. This contains a classification defect; it does not establish why the remaining historical item is rejected or claim complete live-session recovery. No Core, cron, dependency or installed-profile change is included.

## 0.4.0-alpha.36 (prepared)

- Add managed Responses wire-only replay normalization through the native SDK's public `onPayload` seam, preserving durable history, encrypted reasoning, message phases and tool-result pairing (#162). Reference-only or incomplete ID-bearing forms fail explicitly instead of silently discarding history.
- Recognize the exact structured input-item connection-scope HTTP 401 without retiring shared OAuth proof or aborting neighboring calls. Surface a sanitized, dispatch-local `INVALID_REQUEST`; genuine and unrecognized authentication failures retain existing recovery.
- Preserve native transport, caller callbacks, cancellation, credentials and model selection. No automatic request retry, alternate adapter, Core/SDK patch, canonical-route takeover or live-profile mutation is introduced.
- Add real-SDK/pinned-Core synthetic regressions for replay shape, caller callback composition, bounded response inspection, parallel isolation, cancellation and genuine authentication recovery. Real Copilot acceptance of existing conversations, deployment and activation remain separate acceptance steps.

## 0.4.0-alpha.35 (prepared)

- Match the account-usage control to native secondary statistics typography, line height and pill spacing (#160).
- Keep its label on one line within the host's available width, with ellipsis and a full-label tooltip for constrained layouts; independent details, focus and account-wide billing semantics remain unchanged.
- Remove the permanently unavailable Session credits section. Hide missing, malformed, zero or elapsed reset metadata instead of displaying the Unix epoch; prefer a valid snapshot reset, then a valid account-level date, without inventing dates or discarding otherwise valid quota amounts.
- Continue using the existing additive composer dock. Shared-row placement and responsive wrapping belong to the host layout; no private DOM relocation, native statistics replacement or new Core API dependency is introduced by this plugin.
- Preserve alpha.34's Model roles retirement and compatibility-only historical Session behavior. This presentation update does not install, activate or restart a profile.

## 0.4.0-alpha.34 (prepared, PR-only)

- Retire the Model roles / planner-executor settings, legacy Settings fallback, and dedicated-session creation UI (#158); ordinary Sessions and Core-owned subagents remain the intended workflow.
- Remove obsolete role Client components and browser fixtures, with negative registration and adjacent account/search/usage regressions.
- Keep existing dedicated-session policy replay and strict Remote contracts for compatibility; reject role configuration writes and new dedicated roots explicitly, retaining evidence-only recovery of matching existing requests.
- Do not migrate or delete saved settings, histories, credentials, model choices or global defaults. Native parent-to-child model rules remain separately pending Core work, not a capability supplied by this retirement.
- Version metadata prepares the required PR release gate only; merge, publication, installation and activation are not part of this PR-only request.

## 0.4.0-alpha.33 (prepared)

- Fix the account-usage composer component to call the public `useSession(selector)` hook with a selector instead of assuming a no-argument snapshot API (#156).
- Preserve native Session ownership and select only the open/current/not-removed predicate; no Core patch, credential change, network-policy change or automatic restart is required.
- Add positive canonical/managed Copilot rendering and required-selector lifecycle regressions. Earlier signed-out absence tests do not establish that the eligible-session control can render.

## 0.4.0-alpha.32 (prepared)

- Add an optional, Copilot-session-scoped composer usage control without replacing the native Context meter or changing other providers (#153).
- Read bounded account quota snapshots through the canonical Host-owned OAuth grant and a separate strict usage Remote namespace; preserve the existing authorization contracts.
- Distinguish AI credits, legacy premium requests, individual budgets, shared pools, unavailable data and last-known snapshots. Never invent remaining credits from missing metadata, token estimates or another session.
- Keep per-session credits explicitly unavailable until a supported public native accounting seam exposes complete provider-reported usage; no second model transport, Core patch, live-profile installation or restart is included.

## 0.4.0-alpha.31 (prepared)

- Retire the exact current managed-route token proof after an observed model HTTP 401, preserving the native failure without replay, logout or model switching (#152).
- Let the next independent caller renew a rejected token through native `Models.getAuth()` and the serialized canonical credential store, even if its stored expiry is still in the future. Never persist a projected expiration or replace a newer sign-in.
- Bound recovery per account using the existing cooldown setting (five minutes by default, one-second floor); reject identical-token renewal and ignore late generations, 403, cancellation and error strings without an observed HTTP response.
- Cover sign-out/sign-in with retained conversation history, native HTTP transports, concurrent renewal, credential races and cooldown. Synthetic evidence does not prove the original endpoint rejection cause, live OAuth/model acceptance, WebSocket recovery, publication or Desktop activation.

## 0.4.0-alpha.30 (prepared)

- Route verification links on recognized Desktop v1 hosts through the existing same-window external-navigation handoff instead of popup creation; retain new tabs on web hosts (#150).
- Display a selectable verification address for manual browser handoff without claiming that the system browser opened or authorization succeeded.
- Remove the Compatibility and existing configurations disclosure from Manage. Preserve legacy configuration diagnostics, explicit repair, migration documentation, credentials and session behavior.
- Cover Desktop/web targets, manual URL handoff and expanded Manage across account states. Synthetic Client evidence does not establish live Desktop activation or OAuth success.

## 0.4.0-alpha.29 (prepared)

- Fix search settings drafts and pending saves being reset by parent renders: capture stable traced Settings/routing Remote faces once per registration (#148).
- Make ordinary Web search settings provider-only, rename the final default to Fallback provider, and save both routing choices in one namespace CAS without model discovery or a model prerequisite.
- Resolve independent Copilot search models from current account-owned Responses metadata in deterministic order, with at most three capability-probed candidates and one final query. Preserve allowlists, explicit overrides, account/owner proof, cancellation and fallback policy; never borrow a Chat/global default or hardcode model IDs.
- Preserve existing model overrides and offer a separate explicit reset to automatic selection. Classify safe save/conflict diagnostics without exposing raw Remote errors.
- Add real pinned Settings/Client-codec contracts, mounted React/Cordis lifecycle tests, and isolated built-browser before/after reproduction. These are not live OAuth/search, published-release or installed Desktop acceptance claims.

## 0.4.0-alpha.28 (prepared)

- Enforce plugin-owned estimated independent prompt and combined input/output budgets on the managed Copilot route while preserving advertised context capacity and native transport (#146).
- Signal eligible exact-session loop pressure before model dispatch through the existing official bounded compaction/rebuild path; respect disabled automatic recovery, model-specific zero retries and cancellation.
- Prefer supported minimal/low reasoning only for compaction with no supplied or materialized effort, without silently rewriting the requested summary output cap or changing ordinary conversations.
- Preserve structured local admission failures through SDK wrapping, current system/tool accounting, concurrent-call isolation and distinct output-truncation outcomes. Add configurable safety/pressure/summary policy and regression coverage.
- Keep already oversized manual summaries as explicit failures; this release does not claim chunked recovery, silent history deletion, automatic model switching, Core changes or local Desktop activation.

## 0.4.0-alpha.27 (prepared)

- Remove the separate Model roles workspace dropdown: role settings remain profile-global and saving does not require a workspace (#144).
- Show the current workspace read-only for explicit dedicated-session creation, observing public Client lists on both legacy selection and alpha.2 main-view ownership. Missing or ambiguous selection disables creation rather than choosing a first/recent workspace.
- Retain one traced Remote face per UI registration so navigation preserves drafts and uncertain-create UUID/workspace/revision across footer/fallback remounts. Ordinary and existing sessions remain unchanged.
- Add mounted Cordis/React and current-workspace regressions without changing Core, dependencies, Host codecs or session policy.

## 0.4.0-alpha.26 (prepared)

- Fix low-contrast native dropdown options in dark mode for planning/execution models, workspaces and search providers (#142).
- Pair opaque application-theme surfaces with primary or secondary foreground tokens on both selects and options, with readable system-color fallbacks on hosts without those tokens.
- Preserve disabled/unavailable choices and all selection, CAS and session behavior. Add focused regressions and remove fixture-only option colors that masked the production bug; no Core or dependency changes are required.

## 0.4.0-alpha.25 (candidate)

- Append the ninth exact official target `dsh-v0.1.6-alpha.2` at `ddefc45fbc7f8e46dd73185e68295696d1297887`, retaining all older pins and exact `0.1.2-rc.1` development dependencies.
- Supply strict Remote `create()` factories with a legacy `schema` bridge over the same parser; preserve endpoint contracts and validation rather than weakening to `src-json`.
- Correct dedicated executor projection admission to native `subagent/descriptor` v3. Native descriptors were already v3 in rc.1; the plugin's old v1 assumption was a bug, not an upstream format migration.
- Bump the plugin projection cache to `stateVersion: 2` to force refolding. Unknown/v1/v2 descriptor histories fail closed and remain unmodified; recovery requires a reviewed new child, never relabeling or fabricated conversion.
- Add strict-codec, descriptor/projection and exact-alpha.2 contract fixtures, plus an [official-first comparison and retirement plan](./docs/official-first-016-alpha2.md) for retained custom surfaces.
- Evidence remains limited: source markers, local rc.1-backed focused tests and fifteen scoped exact-source runtime tests passed (alpha.2 contracts 8, Remote 1 and Session-context 6; supplemental resolver with official TypeScript `6.0.3`, declared `mime-types@3.0.2` and `ws@8.21.0`, and shared Zod `^4.4.3`, no source/dependency patches). Full local `pnpm verify` passed: 1373 Vitest tests with 2 expected skips, 176 tooling tests, typechecks/build/package smoke; pack/tarball verification passed. Broad frozen dependency installation remains blocked by the configured mirror's `node-addon-require-builtin@0.1.6` HTTP 404. Full official-root-helper and CI qualification remain pending. This candidate is not a published-artifact, live Desktop, OAuth or model-call compatibility claim.

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
