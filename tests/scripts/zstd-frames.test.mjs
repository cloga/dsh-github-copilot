import assert from 'node:assert/strict'
import test from 'node:test'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { zstdFrameRanges } from '../../scripts/zstd-frames.mjs'

test('separates exact original frame boundaries regardless of Node multi-frame decompression', () => {
  const values = [Buffer.from('header\n'), Buffer.alloc(500_000, 42), Buffer.from('tail\n')]
  const frames = values.map(value => zstdCompressSync(value, { params: { [constants.ZSTD_c_checksumFlag]: 1 } }))
  const bytes = Buffer.concat(frames)
  let offset = 0
  const expected = frames.map(frame => {
    const start = offset; offset += frame.length
    return { start, end: offset }
  })
  assert.deepEqual([...zstdFrameRanges(bytes)], expected)
  for (const [index, { start, end }] of [...zstdFrameRanges(bytes)].entries()) {
    assert.deepEqual(zstdDecompressSync(bytes.subarray(start, end)), values[index])
  }
})

test('rejects truncated headers, blocks, checksum, reserved forms and trailing junk', () => {
  const frame = zstdCompressSync(Buffer.from('synthetic header\n'),
    { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
  for (let length = 1; length < frame.length; length++) {
    assert.throws(() => [...zstdFrameRanges(frame.subarray(0, length))], /INVALID_ZSTD_FRAME/)
  }
  const reserved = Buffer.from(frame); reserved[4] |= 0x08
  for (const bytes of [reserved, Buffer.concat([frame, Buffer.from([0])]), Buffer.alloc(9)]) {
    assert.throws(() => [...zstdFrameRanges(bytes)], /INVALID_ZSTD_FRAME/)
  }
})

test('bounds physical frame work including empty frames', () => {
  const empty = zstdCompressSync(Buffer.alloc(0))
  assert.throws(() => [...zstdFrameRanges(Buffer.concat(Array(65_537).fill(empty)))], /ZSTD_FRAME_LIMIT/)
})

test('handles RLE blocks and windowed frames without a declared content size', () => {
  const rle = Buffer.from('28b52ffd20052b00007a', 'hex')
  const windowed = Buffer.from('28b52ffd0000190000616263', 'hex')
  const input = Buffer.concat([rle, windowed])
  assert.deepEqual([...zstdFrameRanges(input)], [{ start: 0, end: rle.length }, { start: rle.length, end: input.length }])
  assert.equal(zstdDecompressSync(rle).toString(), 'zzzzz')
  assert.equal(zstdDecompressSync(windowed).toString(), 'abc')
})
