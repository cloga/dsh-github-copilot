import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DIAGNOSTICS_ANALYSIS_MAX_INPUT_BYTES, readBoundedDiagnosticsFile,
} from '../src/diagnostics-analysis-io.ts'
import { diagnosticsUnitName, parsePersistedUnit } from '../src/diagnostics-analysis.ts'

function stat(overrides: Record<string, unknown> = {}) {
  return {
    isFile: () => true,
    isSymbolicLink: () => false,
    size: 0,
    mtimeMs: 10,
    ctimeMs: 10,
    dev: 1,
    ino: 1,
    ...overrides,
  }
}

function fakeIo(text: string | Buffer, config: {
  pathStats?: ReturnType<typeof stat>[]
  handleStats?: ReturnType<typeof stat>[]
  beforeOpen?: (flags: string) => void
} = {}) {
  const bytes = typeof text === 'string' ? Buffer.from(text, 'utf8') : text
  let pathReads = 0
  let handleReads = 0
  let opened = 0
  const stable = stat({ size: bytes.length })
  const pathStats = config.pathStats ?? [stable, stable]
  const handleStats = config.handleStats ?? [stable, stable]
  const io = {
    async lstat() {
      const value = pathStats[Math.min(pathReads, pathStats.length - 1)]!
      pathReads++
      return value
    },
    async open(_path: string, flags: 'r') {
      opened++
      config.beforeOpen?.(flags)
      return {
        async stat() {
          const value = handleStats[Math.min(handleReads, handleStats.length - 1)]!
          handleReads++
          return value
        },
        async read(buffer: Buffer, offset: number, length: number, position: number) {
          const bytesRead = bytes.copy(buffer, offset, position, position + length)
          return { bytesRead, buffer }
        },
        async close() {},
      }
    },
  }
  return { io, opened: () => opened }
}

const path = resolve('synthetic-diagnostics.json')
const unit = diagnosticsUnitName('desktop')

describe('bounded local diagnostics reader', () => {
  it('opens only the explicit regular file as read-only and validates strict UTF-8', async () => {
    const content = '{"synthetic":"aggregate-only"}'
    const flags: string[] = []
    const fake = fakeIo(content, { beforeOpen: value => flags.push(value) })
    await expect(readBoundedDiagnosticsFile(path, fake.io)).resolves.toBe(content)
    expect(flags).toEqual(['r'])
    expect(fake.opened()).toBe(1)
  })

  it('rejects a symlink before opening it', async () => {
    const fake = fakeIo('{}', { pathStats: [stat({ isSymbolicLink: () => true, isFile: () => false })] })
    await expect(readBoundedDiagnosticsFile(path, fake.io))
      .rejects.toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_SYMLINK_REJECTED')
    expect(fake.opened()).toBe(0)
  })

  it('rejects non-files and oversized inputs before opening them', async () => {
    const directory = fakeIo('{}', { pathStats: [stat({ isFile: () => false })] })
    await expect(readBoundedDiagnosticsFile(path, directory.io))
      .rejects.toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_NOT_REGULAR_FILE')
    expect(directory.opened()).toBe(0)
    const oversized = fakeIo('{}', {
      pathStats: [stat({ size: DIAGNOSTICS_ANALYSIS_MAX_INPUT_BYTES + 1 })],
    })
    await expect(readBoundedDiagnosticsFile(path, oversized.io))
      .rejects.toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_INPUT_LIMIT')
    expect(oversized.opened()).toBe(0)
  })

  it('rejects a file that changes on the open handle or is replaced at its path', async () => {
    const data = '{"synthetic":"aggregate-only"}'
    const initial = stat({ size: Buffer.byteLength(data) })
    const changed = stat({ size: Buffer.byteLength(data), mtimeMs: 11 })
    const handleChanged = fakeIo(data, { handleStats: [initial, changed] })
    await expect(readBoundedDiagnosticsFile(path, handleChanged.io))
      .rejects.toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_FILE_CHANGED')
    const replaced = fakeIo(data, { pathStats: [initial, stat({ size: initial.size, ino: 2 })] })
    await expect(readBoundedDiagnosticsFile(path, replaced.io))
      .rejects.toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_FILE_CHANGED')
  })

  it('rejects invalid UTF-8, malformed units, and private fields without echoing values', async () => {
    const invalidUtf8 = fakeIo(Buffer.from([0xff, 0xfe]))
    await expect(readBoundedDiagnosticsFile(path, invalidUtf8.io))
      .rejects.toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_UTF8')
    const privateValue = 'private-account-marker'
    const invalidUnit = fakeIo(JSON.stringify({
      unit: { name: unit, version: 1 },
      global: { schemaVersion: 1, accountId: privateValue },
      tables: {},
    }))
    const text = await readBoundedDiagnosticsFile(path, invalidUnit.io)
    let message = ''
    try { parsePersistedUnit(text, unit) } catch (error) {
      message = error instanceof Error ? error.message : ''
    }
    expect(message).toBe('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_SNAPSHOT')
    expect(message).not.toContain(privateValue)
  })

  it('rejects relative paths without opening a writer or reader', async () => {
    const fake = fakeIo('{}')
    await expect(readBoundedDiagnosticsFile('relative.json', fake.io))
      .rejects.toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_PATH')
    expect(fake.opened()).toBe(0)
  })
})
