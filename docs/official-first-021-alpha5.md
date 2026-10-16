# Official-first qualification: DSH 0.2.1-alpha.5

Tracking: [#422](https://github.com/cloga/dsh-github-copilot/issues/422).
The fixed official target is
[`dsh-v0.2.1-alpha.5`, `1517a4dbca0a2789ff1d41ba439600f8547d23fa`](https://github.com/deepseek-ai/deepseek-harness/tree/1517a4dbca0a2789ff1d41ba439600f8547d23fa).
The plugin starts from alpha.16, main commit
`bb25d425342ee660049a8320585f967671d49ec4`, not an earlier feature branch.
Later upstream targets are outside this qualification.

## Exact delta and decisions

The complete, nontruncated alpha.4/alpha.5 Git-tree comparison identifies the
changed relevant source in `ui-model-selection` (`ModelSelect.tsx`, `index.ts`,
`slots.ts`) and `tools` (`index.ts`, `ptc.ts`, `ts-types.ts`, `py-types.ts`).
The adapter, BasicCompactionEngine, credential seams, token meter, Auto reviewer
and existing Chat Usage/composer contracts are unchanged. Version churn across
package manifests still requires exact package qualification, not a startup
exemption. A truncated compare response is not the basis for this conclusion.

The [alpha.4 surface-by-surface review](./official-first-021-alpha4.md) remains
the source of each retained gap and concrete retirement trigger. This delta
does not demonstrate a new native replacement.

| Surface | Official support / remaining gap | Decision |
|---|---|---|
| Admission and public adapter | Exact alpha.5 packages; native SDK remains `^1.1.0`. Official Cordis `4.0.5-alpha.2`, Loader `1.0.6-alpha.2`, schemastery `3.18.5-alpha.2` and Zod `4.4.3` contracts are unchanged. Adapter resolution is inspected independently of the plugin's exact SDK `1.1.0`. | Migrate engines, peers, reviewer callback/package identity, baseline and both platform gates together. No `allow-version`, dependency patch or transitive override. |
| PTC schema and instructions | Native `run_code` presents code before description; TypeScript function-body output uses return/print, while REPL output remains explicit. Native tool execution, sandbox/approval, canonical output and retries remain upstream-owned. | Regress actual public native schema/SDK plus Copilot-only escalation removal and action-specific Goal filtering. Retain local filtering until native Copilot schemas provide equivalent guarantees; no execution wrapper or permission change. |
| Model label slot | `conversation.input.model.label` is single, session-scoped, inline and noninteractive. Its provider id/name, exact catalog model, trigger/menu/option placement and selected flag describe selection UI, not historical execution. | Document opportunity only. Do not register a new label, redesign UX or infer executed/billed models. Native selection remains the owner. |
| Accounts, refresh, metadata and Auto | No new replacement for independently authorized accounts, certified-refresh proof, exclusions, parent following or frozen Auto policy. | Retain all account/turn fences and policies. No profile, selector, history or consent migration; no new durable decision records. |
| Compaction, replay, images and liveness | Relevant implementations unchanged. Native token units, complete tool spans, final admission, native transactions and noncooperative cleanup remain required. | Retain the selected recovery engine's at-most-16 physical calls, exact replay consent and separate byte/semantic guards. Preserve alpha.15 planning/refresh fixes. |
| Thinking, Usage and additive UI | Native blank-reasoning suppression remains; Usage still has incomplete-attribution limits. Existing strict gateways and additive mounts remain required. | Keep alpha.16 renderer/provenance retirement. Regress native settled/running/interrupted presentation, account selector and Host/Client gateways; no new historical execution claim. |
| Search and diagnostics | No equivalent account-bound search proof or independent bounded diagnostics/gzip consent replacement is demonstrated. | Retain existing proof, cancellation, retention, clear fences and native retry/Usage ownership. No live query or automatic collection. |
| Other upstream benefits | Skill-list refresh on plugin enable, terminal query/cache/recovery improvements and Page Up layout are upstream changes. | Delegate to native behavior; no copied implementation or unrelated plugin redesign. |

Twelve earlier exact pins, including alpha.4, remain historical evidence, not
current admission or release gates. Rc.2 hosts must retain alpha.15 or their
existing compatible version. Alpha.4 hosts can retain alpha.16.

## Qualification and evidence limits

Required CI runs unchanged exact tagged-source and published-artifact acceptance
on Windows and Linux, complete plugin gates, native Chat rendering, strict
gateways/mounts, SDK type identity, package smoke and original tarball checks.
All 28 native reviewer regressions must execute with no skips. Synthetic
credentials and transports never authorize live access.

Local `pnpm verify` cannot start source typechecking because dependencies are
missing. `pnpm install --frozen-lockfile --ignore-scripts` reaches the unchanged
lock but the authorized enterprise mirror returns HTTP 404 for
`@aws-sdk/credential-provider-http@3.972.76`. This is local validation blocked,
not passed. Dependency metadata may be generated by authorized official-registry
CI and adopted exactly; no package blobs, alternate versions or Core edits
are used to bypass local policy. Protected complete CI is authoritative.

The exact alpha.5 lock metadata was generated by
[the isolated metadata job](https://github.com/cloga/dsh-github-copilot/actions/runs/38959902431)
and adopted without dependency substitutions. Protected frozen Windows/Linux
installs then correctly rejected 63 entries under the existing 24-hour
`minimumReleaseAge` default inherited from pnpm 11.7.0. Repository inspection
found no explicit `minimumReleaseAge` value in `pnpm-workspace.yaml`, `.npmrc`
or `package.json`; this is not an organization/GitHub/npm-mandated policy. No
user-requested default or exemption change was made. See the
[pnpm dependency-resolution setting](https://pnpm.io/settings/dependency-resolution#minimumreleaseage).
The latest rejected publication is
`@deepseek-ai/dsh-client-ui-slots@0.2.1-alpha.5` at
`2026-10-16T12:30:52.955Z`; the observed package set clears that age threshold
after `2026-10-17T12:30:52.955Z`, subject to a fresh frozen check.
No default/exemption change, clock override or merge/release bypass is
introduced. Published-artifact fixtures separately exercise native identities,
build and ordinary tests; they do not replace the protected source/package gate.

Source/npm qualification is separate from candidate Desktop artifacts/signatures,
loaded plugin, profile peer resolution, OAuth, live models/search and runtime
health. None of those live layers is claimed. No installation, Desktop upgrade,
restart or profile/settings/history/consent change is authorized. The deferred
live and experimental-record work in #397 remains open.
