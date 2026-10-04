# Image input compatibility

Target: official DSH / Windows Desktop `0.2.0-rc.2`. Plugin-only.

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

The current fix diagnoses explicit incompatibility, not every provider 400.
When advertised restrictions and outgoing projection agree but the endpoint
rejects it, retain the native error. Do not invent capability corrections,
reselect mid-turn, add a fallback wire or replay the request automatically.
An explicit smaller [native image budget](./copilot-compaction.md) changes
outgoing visibility through Core offload; it is not a supplier JSON threshold.

## Verification

Historical tool-image continuation first reproduced the old missed-image
requirement. Regressions now cover all Auto preferences, historical user/tool
images, no vision candidate and native WebP-to-PNG projection against explicit
PNG/JPEG restrictions. A mismatch emits native `finish(error)` with zero model
requests.

The [delivery CI](https://github.com/cloga/dsh-github-copilot/actions/runs/36966798814)
passed exact unchanged rc.2 Windows/Linux source and published-adapter fixtures,
full verification and archive gates. Local synthetic transport demonstrates
admission/ownership, not live endpoint acceptance or a particular Desktop's
loaded version. The original [investigation #236](https://github.com/cloga/dsh-github-copilot/issues/236)
retains the bounded observation and delivery evidence; old local registry
failures are not a permanent unsupported/shipping-pending claim.
