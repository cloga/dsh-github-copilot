# Image input compatibility

Current source target: official DSH `0.2.2-rc.3`. Image projection, offload,
the native adapter and supplier errors remain Core-owned.

Auto considers typed image blocks in all entered messages, including historical
user/tool content after a text-only continuation. It does not infer images
from filenames, tool arguments or offloaded text. It selects only generally
image-capable models, not models proven to accept the eventual projected MIME.

The managed route no longer compares projected image MIME against the account
model's advertised format list before dispatch. Core may re-encode an image, so
the durable attachment's format does not establish the outgoing format. A
supplier may reject a format; native error handling applies, without an
automatic retry, conversion, model switch or history mutation by this plugin.
The former `COPILOT_IMAGE_MEDIA_TYPE_UNSUPPORTED` and related plugin
diagnostics are no longer produced.

The explicit native model-sync operation still skips image models unless the
account advertises all four native request formats. This conservative model
filter is separate from per-request admission and does not prove supplier
acceptance. The original [investigation #236](https://github.com/cloga/dsh-github-copilot/issues/236)
and [#426](https://github.com/cloga/dsh-github-copilot/issues/426) describe
historical behavior, not the current preflight.

`tests/preview-route.spec.ts` exercises native projection and synthetic
dispatch with both matching and nonmatching account MIME lists.
`tests/auto-model-routing.spec.ts` preserves general image eligibility.
Synthetic results do not prove live account, endpoint or Desktop behavior.
