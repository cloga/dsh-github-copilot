# Agent readiness audit

Tracking: [#73](https://github.com/cloga/dsh-github-copilot/issues/73). Audited baseline: `d9d0954` (2026-09-05). This is an evidence inventory, not a blanket certification of live Copilot behavior.

## Scope and method

Read the instruction entrypoints, source ownership boundaries, test/TypeScript configuration, tooling, packaging, CI/release workflows and public Remote contracts. Two independent native DSH reviewers examined verification/release and runtime/diagnostics. All reproduction uses synthetic fixtures. No production credential inspection, sign-in, sign-out, model/search calls, profile installation or DSH restart is part of this audit.

The existing project already has useful architecture boundaries, strict Remote codecs, exact Core pins, credential normalization, broad unit tests, bilingual docs and an immutable-release policy. The gaps were mostly between what an agent could observe and what it was allowed to claim.

## Improvements with executable evidence

| Area | Audit evidence at baseline | Change / acceptance check |
|---|---|---|
| Onboarding/discovery | Commands scattered across prose; no structured task-to-files map | `agent-contract.json`, `scripts/agent.mjs describe/plan`, `verify:agent` check real paths and scripts |
| Safe preflight | `status()` and `inspectGitHubCopilotProviderProfile()` sound read-only but reconcile settings | Separate repository-only `agent:doctor`; output lists `notChecked`, actionable checks and stable exit codes; Node tooling tests cover missing dependencies |
| Attribution | AGENTS/CONTRIBUTING required unspecified co-author; historical bot was copied | Actual-tool `Assisted-by`; DSH example does not invent a bot email; contract validator guards against mandatory copied co-author policy |
| Runtime floor | Declared Node >=22.0.0 but locked pi-ai requires >=22.19.0 | Align package/baseline to >=22.19.0; recommend Node 24 LTS; CI still uses 24, so the minimum is a dependency floor, not a live Node22 certification |
| Compiler evidence | `tsconfig.json` included only src; expanded compilation found 17 diagnostics in tests/configs | `typecheck:tests`, accurate mock/brand/narrowing fixes; no blanket ignores; real Core fixture remains checked only in its pinned checkout |
| Vacuous assertion | Cordis DisposableList was indexed as an array, allowing undefined UID comparisons | Use iterable conversion and assert defined identity before equality in loader tests |
| Build evidence | verify:package checked Host existence, then claimed built Host verified | Import real built Host without the Vitest Typert alias; assert exported contract and label the evidence as import-only |
| Archive delivery | Pack/checksum did not check actual exported files or README media; images were omitted | `verify:tarball` inspects bounded tar data without extraction; rejects paths/links/duplicates/unexpected files/trailing payload; compares the full normalized manifest and every packed file to the checkout/build; checks exports and README media; CI/release run it after packing |
| External verifier safety | Fixed fixture path could overwrite then delete a pre-existing upstream file | Exclusive create, pinned clean tracked sources, physical-path containment, identity/byte-guarded cleanup and bounded child; twelve synthetic failure/sentinel tests including a Windows junction |
| Release prerequisite | Tag workflow could run independently of complete platform/Core matrix | Reuse CI through workflow_call; publish job needs matrix success on tag revision; contract verifier checks the dependency |
| Session model correctness | Inline preflight checked provider but plan sends default-route candidate.model | Match provider AND model; per-session override goes to Core transport, tested with overlapping same-provider requests |
| Documentation freshness | Contribution/PR/bug forms omitted alpha.1; build/activation/install evidence blurred | Updated templates, exact approval boundaries, evidence matrix and retry/rollback guidance |
| Workspace hygiene | Broad lib ignore hid scripts/lib; root packs/.env not ignored | Root-anchor generated /lib, ignore tarballs/secrets; .editorconfig specifies new-file formatting without rewriting history |

Run `pnpm verify` for the local checks. Then `pnpm pack --pack-destination artifacts` and `pnpm verify:tarball -- artifacts/dsh-github-copilot-<package-version>.tgz`. The task planner emits the actual path from package.json. Consult the PR's final results for commands actually executed and current CI status; this document does not hard-code a perpetual passing test count.

## Evidence ladder

1. **Source markers** prove required seams/test names are present, not semantics.
2. **Typechecks and synthetic tests** verify local assumptions, not installed account eligibility.
3. **Built import/loader checks** prove modules load without test aliases; they do not call apply().
4. **Pinned upstream config fixtures** prove configuration against those sources, not the entire companion Host on every runtime.
5. **Archive/checksum inspection** proves shipped bytes and packaging consistency, not authenticated requests.
6. **Explicit live acceptance** must separately check installed versus loaded version, actual session model, normal stream/tools, and selected search provider. A page returning HTTP 200 proves only reachability.

Missing evidence is `notChecked`, not success. Repository CLI plans do not grant permission to merge, publish, change credentials or install.

## Remaining limitations and follow-up acceptance criteria

- **Read-only runtime status:** current auth status may mutate route/backup settings and can reject on repair failure. A future minimal status DTO should separate credential configured, account snapshot freshness, route health and cached proof, with zero mutation/network in read-only mode. Until then, agents must not call status as a harmless probe.
- **Request-local search:** the conservative gate prevents substitution but does not add native search for a session model that differs from the default. The global prompt/ctx.web plan still derives from the default route. A future Core request-scoped seam should carry provider/model identity; add parallel-session routing and prompt-evidence tests before claiming per-session search.
- **Proof freshness:** cached failed search plans do not key on credential generation. Add lifecycle-triggered bounded reproof and tests for same-model sign-in/revocation; do not bypass proof with probe:false as routine recovery.
- **Temporary-route manual edits:** compare owned postimages before restoring api/models or removing a created profile, including edits after a partially failed restoration. Current pre-existing-profile recovery tests do not prove all created-then-edited cases. Avoid manual edits during temporary ownership; keep a backup before an approved migration.
- **Browser acceptance:** pure React element tests and synthetic screenshots do not establish clipboard permissions, keyboard focus, narrow layouts, pending RPC unmount behavior or a loaded Client update. Add mounted/browser tests with synthetic codes before calling those behaviors fully certified.
- **Minimum runtime/full baseline activation:** local and CI Node24 plus source/config checks are not full Node22.19/live-plugin certifications. Run those explicitly before expanding deployment claims.
- **Security-sensitive diagnostics:** any suspected credential/session/endpoint exposure requires private triage under SECURITY.md with synthetic-sentinel tests. No real secret exposure was established by this audit; do not publish raw logs or provider bodies as evidence.

No attempt is made here to rewrite old commits/tags, auto-enable account models, alter live profile-wide Web provider selection, or introduce a second LLM adapter. The runtime guard can be reverted independently; the tooling and documentation remain useful without installing a plugin release.
