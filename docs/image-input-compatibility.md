# Image input compatibility

Current source target: official DSH `0.2.1-alpha.5`. Plugin-only. Historical
rc.2 delivery evidence below does not qualify the current source or a loaded
Desktop.

## Current behavior

Auto checks actual typed image blocks in **all entered messages**, including
historical user/tool content after a text-only continuation. It does not inspect
tool arguments or infer images from filenames/textual offload placeholders.
Core's `offloaded: true` marker means projected text, not image bytes.

The picker advertises aggregate image input only with an eligible account image
model. Auto filters text-only candidates before task preferences; no eligible
image model fails explicitly rather than sending content to an unverified route.

For fixed and Auto managed calls, the account-bound public `inspectRequest`
hook checks the native transcript's **projected MIME** before wire dispatch:

| Diagnostic | Meaning |
|---|---|
| `COPILOT_IMAGE_INPUT_UNSUPPORTED` | Current account model does not admit image input |
| `COPILOT_IMAGE_MEDIA_TYPE_UNAVAILABLE` | Actual projected MIME evidence is unavailable |
| `COPILOT_IMAGE_MEDIA_TYPE_UNSUPPORTED` | Explicit account MIME restrictions reject that projection |

Omitted account MIME lists preserve existing verified vision behavior but do
not prove universal format acceptance. The plugin neither invents a list nor
converts images itself. Native error/finish behavior, historical attachments,
turn freezing and existing cancellation/retry policy stay unchanged.

### Admission error details

The standard native `INVALID_REQUEST` failure message retains the diagnostic
code and now explains why the request was blocked before selected-model wire
dispatch. It includes a bounded, content-free JSON diagnostic: selected real
model ID (safe identifiers only, otherwise `unavailable`), normalized projected
MIME (invalid/missing/overlong values become `unavailable`), up to eight explicit
allowed MIME types with total count and truncation flag, projected message/block
zero-based indices, allowlisted projected role, and this plugin build's version.
An absent allowed list is `null`, not an empty list or universal format proof.
These positions refer to the native projected transcript, not durable history
IDs or an attachment identity. Only the first rejected image is reported.

This uses the existing error/finish presentation, not a new Remote, collector,
diagnostic store, or history event. Image bytes, URLs, paths, prompt text and
credentials are never included. Native handling of failure messages is unchanged;
this is not a claim that native failures are never retained. The version describes
the build producing this error, not the plugin loaded during an earlier incident.
Earlier Auto assessment traffic, if any, is not a selected-model dispatch.

History images can cause this failure on a text-only continuation. The error
offers explicit next-turn choices: select a model whose current advertised formats
accept the projection, or start a separate text-only Session without those
historical images. Missing MIME needs investigation using the diagnostic, not
guessing from filenames. There is no automatic retry, model switch, image removal,
conversion, or history mutation.

## Evidence layers and recovery limits

Source filename, durable attachment MIME and outgoing projected MIME are
different facts. Native rc.2 prepares images through public attachment services
and may re-encode them. A `.png` display name can belong to durable WebP; that
alone does not establish what the provider received.

Do not exclude a model by name to conceal a format failure. A supplier/model
card's general vision claim is not GitHub endpoint format proof. Exact-format
Auto filtering from durable MIME can reject a model whose native projection
would be accepted; candidate-specific projection would require another public
contract and reviewed tests.

Auto currently filters general image capability, not the final candidate-specific
projected MIME. A vision-eligible selection may therefore still fail the final
format gate. This diagnostic improvement does not close that capability gap.
The current public seam used here receives projection only in `inspectRequest`,
after model selection. Do not pre-project candidates through private APIs or
replace this fail-closed gate with inferred durable-format filtering.

The current fix diagnoses explicit incompatibility, not every provider 400.
When advertised restrictions and outgoing projection agree but the endpoint
rejects it, retain the native error. Do not invent capability corrections,
reselect mid-turn, add a fallback wire or replay the request automatically.
An explicit smaller [native image budget](./copilot-compaction.md) changes
outgoing visibility through Core offload; it is not a supplier JSON threshold.

## Verification

`node --test tests/scripts/image-input-admission.test.mjs` exercises the real
TypeScript admission helper using Node's built-in runner: historical user/tool
projections, missing/invalid/unsupported formats, absent versus empty restrictions,
bounded redacted diagnostics, no private-content reads and no input mutation.
It does not exercise the native adapter or Client.
`tests/preview-route.spec.ts` covers the native failure/finish surface and no
selected-model wire on rejection; `tests/auto-model-routing.spec.ts` preserves the
explicit separation between Auto vision eligibility and final projected-format
admission. These require the unchanged pinned dependencies. Passing the
dependency-free helper tests is not a substitute for those integration gates.

Historical tool-image continuation first reproduced the old missed-image
requirement. Regressions now cover all Auto preferences, historical user/tool
images, no vision candidate and native WebP-to-PNG projection against explicit
PNG/JPEG restrictions. A mismatch emits native `finish(error)` with zero model
requests.

The historical [delivery CI](https://github.com/cloga/dsh-github-copilot/actions/runs/36966798814)
passed exact unchanged rc.2 Windows/Linux source and published-adapter fixtures,
full verification and archive gates. Local synthetic transport demonstrates
admission/ownership, not live endpoint acceptance or a particular Desktop's
loaded version. The original [investigation #236](https://github.com/cloga/dsh-github-copilot/issues/236)
retains the bounded observation and delivery evidence; old local registry
failures are not a permanent unsupported/shipping-pending claim.
