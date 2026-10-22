# Image input compatibility

Target: official DSH / Windows Desktop `0.2.0-rc.2`. Plugin-only. This
maintenance-line backport of #426 and #430 format mitigation preserve the rc.2 dependency graph; they
does not install or require the separate alpha.5 Core baseline.

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
| `COPILOT_IMAGE_MEDIA_TYPE_UNADVERTISED` | Nonblocking Host diagnostic: valid projected MIME is absent from the explicit advertised list |

Omitted account MIME lists preserve existing verified vision behavior but do
not prove universal format acceptance. The plugin neither invents a list nor
converts images itself. An explicit advertised list, including an empty list,
is not proof that the endpoint rejects an unlisted valid image format.
The plugin reports only the fixed `COPILOT_IMAGE_MEDIA_TYPE_UNADVERTISED` code
through the existing Host logger, at most once per projected request, and
delegates to the native request and server. This is not a Client notice, stored
diagnostic population or evidence of format support. Native error/finish behavior, historical attachments,
turn freezing and existing cancellation/retry policy stay unchanged.

### Admission error details

For non-vision input or missing/invalid projected MIME, the standard native
`INVALID_REQUEST` failure message retains the diagnostic
code and now explains why the request was blocked before selected-model wire
dispatch. It includes a bounded, content-free JSON diagnostic: selected real
model ID (safe identifiers only, otherwise `unavailable`), normalized projected
MIME (invalid/missing/overlong values become `unavailable`), up to eight explicit
allowed MIME types with total count and truncation flag, projected message/block
zero-based indices, allowlisted projected role, and this plugin build's version.
An absent allowed list is `null`, not an empty list or universal format proof.
These positions refer to the native projected transcript, not durable history
IDs or an attachment identity. Only the first rejected image is reported.
Advertised-format mismatches do not produce this failure or its metadata.

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
projected MIME. The public seam used here receives projection only in
`inspectRequest`, after model selection. Exact rc.2 `prepareCall()` captures
model/config metadata and a stream capability, not a projected transcript.
Native image preparation occurs during stream consumption after auth resolution;
the public attachment target exposes dimensions and byte budget, not an output
format selector or a reusable prepared-transcript handoff. Do not duplicate that
projection or infer outgoing formats from durable MIME.

The user-approved #430 mitigation removes only the advertised-format mismatch
veto; it does not require preselection projection, implement format-aware Auto,
or prove that Grok or any Copilot endpoint supports WebP. xAI's documentation
lists JPEG/PNG, but that declaration and a local precheck failure are not a live
Copilot endpoint rejection. The request now reaches the unchanged native path
once; existing native retry policy remains its owner, with no plugin-added retry.
Missing/invalid MIME, non-vision input, account/proof, cancellation and capacity
checks remain independent. Unlisted formats may still be rejected by the server.

The mitigation removes an overly strict local format veto, not every provider 400.
Whether or not advertised formats and outgoing projection agree, an endpoint
rejection retains the native error. Do not invent capability corrections,
reselect mid-turn, add a fallback wire or replay the request automatically.
An explicit smaller [native image budget](./copilot-compaction.md) changes
outgoing visibility through Core offload; it is not a supplier JSON threshold.

## Verification

`node --test tests/scripts/image-input-admission.test.mjs` exercises the real
TypeScript admission helper using Node's built-in runner: historical user/tool
projections, missing/invalid MIME, nonblocking unadvertised formats, absent versus empty lists,
bounded redacted diagnostics, no private-content reads and no input mutation.
It does not exercise the native adapter or Client.
`tests/preview-route.spec.ts` covers the native failure/finish surface and no
selected-model wire on structural rejection and single native delegation on format
mismatch; `tests/auto-model-routing.spec.ts` preserves the
explicit separation between Auto vision eligibility and final projected-format
admission. These require the unchanged pinned dependencies. Passing the
dependency-free helper tests is not a substitute for those integration gates.

Historical tool-image continuation first reproduced the old missed-image
requirement. Regressions now cover all Auto preferences, historical user/tool
images, no vision candidate and native PNG-to-WebP projection against explicit
PNG/JPEG declarations. A mismatch now delegates without a plugin veto; a native server rejection retains
its native failure. Synthetic regressions cover accepted and unadvertised formats,
one dispatch, and unchanged historical input, not live endpoint acceptance.

The historical [delivery CI](https://github.com/cloga/dsh-github-copilot/actions/runs/36966798814)
passed exact unchanged rc.2 Windows/Linux source and published-adapter fixtures,
full verification and archive gates for the earlier implementation, not this
mitigation. The alpha.5 fix's CI is not rc.2 qualification either.
Local synthetic transport demonstrates
admission/ownership, not live endpoint acceptance or a particular Desktop's
loaded version. The original [investigation #236](https://github.com/cloga/dsh-github-copilot/issues/236)
retains the bounded observation and delivery evidence; old local registry
failures are not a permanent unsupported/shipping-pending claim.
