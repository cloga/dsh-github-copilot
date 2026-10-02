# Image input compatibility investigation and implementation

Tracking: [#236](https://github.com/cloga/dsh-github-copilot/issues/236).
Baseline: official DSH / Windows Desktop 0.2.0-rc.2. Plugin-only.

## Evidence and limits

A failed Auto continuation selected a vision-capable model and received an
image-media-type validation error. Read-only local inspection found historical
`read_image` tool results, including genuine WebP attachments whose display
names ended in `.png`. No conversation bodies, attachment bytes, account data or
opaque replay references are included here.

This does not establish that the model lacks vision, that WebP is universally
unsupported, or that the historical attachment's encoding was sent unchanged.
[AWS's Grok 4.7 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html)
documents image input, but is not evidence of GitHub Copilot endpoint format
acceptance. Do not exclude a model by name to conceal this error.

Two distinct gaps were identified:

1. Auto classified image requirements from only the latest user message.
   Historical user and tool image blocks were missed after a text-only continuation.
2. Account discovery retains `visionMediaTypes`, but dispatch did not check
   the native projected image MIME against that explicit account evidence.

Official rc.2 `llm-pi-ai/src/context.ts` prepares request images through the public
attachment service before provider dispatch. `attachment-local/src/request-image.ts`
can re-encode them. Source filename, durable attachment MIME, and projected
request MIME are therefore different evidence layers.

## Implementation plan and delivered code

1. Add regressions for historical user/tool images followed by text-only
   continuation, all three Auto preferences, and no eligible vision model.
2. Scan typed content blocks in all messages supplied to Auto by the existing
   pre-step hook. Keep latest-user text complexity, account eligibility and
   turn-frozen selection. Do not recursively interpret tool arguments, file
   names or textual offload placeholders as image blocks. Honor Core's explicit
   `offloaded: true` marker, which projects the image to text rather than bytes.
3. At the existing account-bound `inspectRequest` hook, validate the native
   transcript's actual image `mimeType` after Core projection and before wire.
   Restore failures as request-local `INVALID_REQUEST` errors:
   `COPILOT_IMAGE_INPUT_UNSUPPORTED`, `COPILOT_IMAGE_MEDIA_TYPE_UNAVAILABLE`,
   or `COPILOT_IMAGE_MEDIA_TYPE_UNSUPPORTED`.
4. Honor explicit account MIME restrictions. If the account omits its MIME list,
   preserve existing vision behavior; absence is neither proof of universal
   format support nor permission to invent an allowlist.
5. Cover a synthetic native projection that changes durable WebP into PNG:
   advertised PNG is admitted; JPEG-only evidence rejects before model fetch.
   Keep original attachments unchanged.

These changes apply to historical image eligibility at the next Auto decision
and actual projected MIME admission for both fixed and Auto managed requests.
They do not introduce image conversion, history repair, model-name rules,
same-turn reselection, fallback wires, retry loops, or Core patches.

## Deferred capability and acceptance

Do not implement Auto MIME filtering from durable attachments: that can reject
a model even when native projection produces a format it accepts. Exact-format
candidate selection or conversion requires a public, candidate-specific
projection contract and its own tests. The current fix diagnoses explicit
incompatibility; it does not rescue every image request.

The original service-side 400 is not proven fixed. Confirm its account-advertised
limits and exact outgoing MIME without recording image bytes or credentials
before attributing its root cause. If advertised compatibility and actual bytes
agree but the endpoint rejects them, preserve the native error rather than
fabricating a capability correction.

## Validation status

- A pre-fix Node regression reproduced `requiresImage: false` for a historical
  tool image followed by a text-only continuation.
- Focused Auto/admission tests: 23 passed with pinned Vitest 3.2.7 and isolated
  unchanged rc.2 public message helper source. This is supplemental evidence,
  not the complete native integration/full gate.
- Strict targeted TypeScript check passed:
  `node node_modules\typescript\bin\tsc --noEmit --strict --skipLibCheck --target es2023 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions src\auto-model-routing.ts src\image-input-admission.ts`.
- `pnpm install --frozen-lockfile --ignore-scripts --fetch-retries=0 --fetch-timeout=20000`
  failed: the configured enterprise registry returned HTTP 404 for
  `@deepseek-ai/dsh-util-crypto@0.2.0-rc.2`. Full local validation is blocked.
- [CI run 36966798814](https://github.com/cloga/dsh-github-copilot/actions/runs/36966798814)
  passed on Windows and Linux using unchanged official rc.2 dependencies:
  the published-adapter fixture, tagged-source native runtime, full `pnpm verify`,
  `pnpm pack --pack-destination artifacts`, and exact tarball verification.
  The full gate includes 1990 passing Vitest tests (2 expected skips) and
  310 passing tooling tests. Native MIME admission preserves Core's streamed
  `finish(error)` contract and sends zero model requests for the mismatch case.
- This authorized CI path mitigates the local registry blocker without changing
  dependencies or bypassing local registry policy. Publication and live
  acceptance remain separate; no installed or published fix is claimed here.
