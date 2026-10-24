/** Locate standard Zstandard frames without relying on Node's concatenation behavior. */
export function* zstdFrameRanges(input) {
  let offset = 0
  let frames = 0
  const advance = bytes => {
    if (bytes > input.length - offset) throw new Error('AUTO_HISTORY_INVALID_ZSTD_FRAME')
    offset += bytes
  }
  while (offset < input.length) {
    if (++frames > 65_536) throw new Error('AUTO_HISTORY_ZSTD_FRAME_LIMIT')
    const start = offset
    advance(4)
    if (input.readUInt32LE(start) !== 0xfd2fb528) throw new Error('AUTO_HISTORY_INVALID_ZSTD_FRAME')
    advance(1)
    const descriptor = input[offset - 1]
    if (descriptor & 0x18) throw new Error('AUTO_HISTORY_INVALID_ZSTD_FRAME')
    const single = Boolean(descriptor & 0x20)
    const sizeFlag = descriptor >>> 6
    advance((single ? 0 : 1) + [0, 1, 2, 4][descriptor & 3]
      + (sizeFlag ? 2 ** sizeFlag : single ? 1 : 0))
    let last = false
    while (!last) {
      advance(3)
      const block = input.readUIntLE(offset - 3, 3)
      const type = block >>> 1 & 3
      const size = block >>> 3
      if (type === 3 || size > 131_072) throw new Error('AUTO_HISTORY_INVALID_ZSTD_FRAME')
      last = Boolean(block & 1)
      advance(type === 1 ? 1 : size)
    }
    if (descriptor & 4) advance(4)
    yield { start, end: offset }
  }
}
