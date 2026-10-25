import assert from 'node:assert/strict'
import test from 'node:test'
import { imageInputFailure } from '../../src/image-input-admission.ts'
import manifest from '../../package.json' with { type: 'json' }

const model = { id: 'fixture-vision', input: ['text', 'image'],
  evidence: { visionMediaTypes: ['image/png', 'image/jpeg'] } }
const image = mimeType => ({ type: 'image', mimeType,
  get data() { throw new Error('image bytes must not be read') },
  get url() { throw new Error('URL must not be read') },
  get path() { throw new Error('path must not be read') } })
const transcript = (mimeType, role = 'user') => [
  { role: 'user', content: [{ type: 'text', text: 'private prompt' }] },
  { role, content: [{ type: 'text', text: 'private output' }, image(mimeType)] },
  { role: 'user', content: [{ type: 'text', text: 'continue' }] },
]

for (const role of ['user', 'toolResult']) {
  test(`historical ${role} image reports bounded metadata after text-only continuation`, () => {
    const failure = imageInputFailure(model, transcript('IMAGE/WEBP', role))
    assert.equal(failure.code, 'COPILOT_IMAGE_MEDIA_TYPE_UNSUPPORTED')
    assert.deepEqual(failure.diagnostic, { model: model.id, projectedMime: 'image/webp',
      allowedMimeTypes: ['image/png', 'image/jpeg'], allowedMimeTypeCount: 2,
      allowedMimeTypesTruncated: false, messageIndex: 1, blockIndex: 1,
      role, pluginVersion: manifest.version })
    assert.ok(failure.message.includes(JSON.stringify(failure.diagnostic)))
    assert.ok(failure.message.includes('History images also count'))
    assert.ok(failure.message.includes('Request blocked before selected-model dispatch'))
    assert.ok(failure.message.includes('Auto checks general image capability, not candidate-specific projected formats'))
    assert.ok(failure.message.includes('No automatic retry or model switch'))
    assert.ok(!failure.message.includes('private'))
  })
}
for (const mime of [undefined, '', null, 1, 'application/pdf', 'image/png;private']) {
  test(`invalid MIME ${JSON.stringify(mime)} is unavailable, not echoed`, () => {
    const failure = imageInputFailure(model, transcript(mime, 'private role'))
    assert.equal(failure.code, 'COPILOT_IMAGE_MEDIA_TYPE_UNAVAILABLE')
    assert.equal(failure.diagnostic.projectedMime, 'unavailable')
    assert.equal(failure.diagnostic.role, 'unknown')
    assert.ok(!failure.message.includes('private'))
  })
}
for (const mime of ['image/png', 'IMAGE/JPEG']) {
  test(`accepted projection ${mime} does not read private image data`, () => {
    assert.equal(imageInputFailure(model, transcript(mime)), undefined)
  })
}
test('omitted and explicit-empty restrictions are distinct', () => {
  const omitted = { ...model, evidence: {} }
  assert.equal(imageInputFailure(omitted, transcript('image/webp')), undefined)
  assert.equal(imageInputFailure(omitted, transcript(undefined)).diagnostic.allowedMimeTypes, null)
  const empty = { ...model, evidence: { visionMediaTypes: [] } }
  const rejected = imageInputFailure(empty, transcript('image/png'))
  assert.equal(rejected.code, 'COPILOT_IMAGE_MEDIA_TYPE_UNSUPPORTED')
  assert.deepEqual(rejected.diagnostic.allowedMimeTypes, [])
  assert.equal(rejected.diagnostic.allowedMimeTypeCount, 0)
})
test('non-vision model keeps unsupported-input code and projected metadata', () => {
  const failure = imageInputFailure({ ...model, input: ['text'] }, transcript('image/png'))
  assert.equal(failure.code, 'COPILOT_IMAGE_INPUT_UNSUPPORTED')
  assert.equal(failure.diagnostic.projectedMime, 'image/png')
})
test('durable WebP does not veto an accepted native PNG projection or override a rejected one', () => {
  const projected = [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png',
    attachment: { mediaType: 'image/webp' } }] }]
  const original = structuredClone(projected)
  assert.equal(imageInputFailure(model, projected), undefined)
  const jpegOnly = { ...model, evidence: { visionMediaTypes: ['image/jpeg'] } }
  assert.equal(imageInputFailure(jpegOnly, projected).diagnostic.projectedMime, 'image/png')
  assert.deepEqual(projected, original)
})
test('bounded diagnostic does not echo unsafe identifiers or overlong MIME', () => {
  const unusual = { ...model, id: 'https://private.invalid/model',
    evidence: { visionMediaTypes: Array.from({ length: 32 }, (_, i) => `image/x-${i}`) } }
  const failure = imageInputFailure(unusual, transcript(`image/${'x'.repeat(10000)}`, 'private role'))
  assert.equal(failure.diagnostic.model, 'unavailable')
  assert.equal(failure.diagnostic.projectedMime, 'unavailable')
  assert.equal(failure.diagnostic.allowedMimeTypes.length, 8)
  assert.equal(failure.diagnostic.allowedMimeTypeCount, 32)
  assert.equal(failure.diagnostic.allowedMimeTypesTruncated, true)
  assert.ok(failure.message.length < 2400)
  assert.ok(!failure.message.includes('private'))
})
test('maximum displayed identifiers and MIME lists stay below 2400 characters', () => {
  const maximal = { ...model, id: 'a'.repeat(200),
    evidence: { visionMediaTypes: Array.from({ length: 32 }, (_, i) => `image/${String(i).padStart(122, 'x')}`) } }
  const failure = imageInputFailure(maximal, transcript('image/webp'))
  assert.ok(failure.message.length < 2400, failure.message.length.toString())
})
test('frozen input remains unchanged; only first rejection is reported', () => {
  const messages = [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png' },
    { type: 'image', mimeType: 'image/webp' }, { type: 'image', mimeType: 'image/gif' }] }]
  const original = structuredClone(messages)
  messages[0].content.forEach(Object.freeze)
  Object.freeze(messages[0].content)
  Object.freeze(messages[0])
  Object.freeze(messages)
  assert.equal(imageInputFailure(model, messages).diagnostic.blockIndex, 1)
  assert.deepEqual(messages, original)
})
test('ignores text, files, tool arguments, empty and untyped records', () => {
  assert.equal(imageInputFailure({ ...model, input: ['text'] }, [
    null, 1, {}, { content: null }, { content: [{ type: 'text', text: 'photo.png' },
      { type: 'file' }, { type: 'toolCall', arguments: { type: 'image' } }] },
  ]), undefined)
})
