# Image input compatibility

Current source target: official DSH `0.2.2-rc.3`. Image projection, offload,
the native adapter and supplier errors remain Core-owned. DSH owns model
selection and Auto; the old plugin Auto picker and its filtering are retired.

Native request admission does not compare projected image MIME against the
account model's advertised formats before dispatch. Core may re-encode an image,
so a filename or durable attachment format does not establish the outgoing
format. A supplier may reject a format; native error handling applies
without an automatic retry, conversion, model switch or history mutation by this
plugin. The former plugin `COPILOT_IMAGE_MEDIA_TYPE_UNSUPPORTED` and related
preflight diagnostics are no longer produced.

The explicit native model-sync operation submits enabled IDs without filtering
on account image-format claims or copying capability metadata. Its optional
provider-wide API update is gated only on verified protocol metadata and
matching native catalog entries; it does not prove image compatibility or
supplier acceptance. An explicit smaller [native image budget](./copilot-compaction.md)
can change what Core offloads; it is not a supplier JSON threshold.

`tests/preview-route.spec.ts` exercises native projection and synthetic dispatch
with matching and nonmatching account MIME lists. Historical
`tests/auto-model-routing.spec.ts` covers the retired plugin Auto logic, not
current DSH Auto behavior. Synthetic results do not prove live account, endpoint
or Desktop behavior.

The original [investigation #236](https://github.com/cloga/dsh-github-copilot/issues/236),
[#426](https://github.com/cloga/dsh-github-copilot/issues/426), and
[retirement #481](https://github.com/cloga/dsh-github-copilot/issues/481)
describe earlier behavior and evidence, not a current preflight.
