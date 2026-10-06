import { open, lstat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { TextDecoder } from 'node:util'

export const DIAGNOSTICS_ANALYSIS_MAX_INPUT_BYTES = 8 * 1024 * 1024

interface FileStat {
  isFile(): boolean
  isSymbolicLink(): boolean
  size: number
  mtimeMs: number
  dev: number
  ino: number
}
interface ReadHandle {
  stat(): Promise<FileStat>
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
  close(): Promise<void>
}
export interface DiagnosticsAnalysisFileSystem {
  lstat(path: string): Promise<FileStat>
  open(path: string, flags: 'r'): Promise<ReadHandle>
}

const fileSystem: DiagnosticsAnalysisFileSystem = { lstat, open }

function failure(code: string): never {
  throw new Error(`COPILOT_DIAGNOSTICS_ANALYSIS_${code}`)
}

function sameFile(left: FileStat, right: FileStat): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameContentState(left: FileStat, right: FileStat): boolean {
  return sameFile(left, right) && left.size === right.size && left.mtimeMs === right.mtimeMs
}

export async function readBoundedDiagnosticsFile(
  filePath: string,
  io: DiagnosticsAnalysisFileSystem = fileSystem,
): Promise<string> {
  if (!isAbsolute(filePath)) failure('INVALID_PATH')
  let pathBefore: FileStat
  try { pathBefore = await io.lstat(filePath) } catch { failure('FILE_READ_FAILED') }
  if (pathBefore.isSymbolicLink()) failure('SYMLINK_REJECTED')
  if (!pathBefore.isFile()) failure('NOT_REGULAR_FILE')
  if (pathBefore.size > DIAGNOSTICS_ANALYSIS_MAX_INPUT_BYTES) failure('INPUT_LIMIT')

  let handle: ReadHandle
  try { handle = await io.open(filePath, 'r') } catch { failure('FILE_READ_FAILED') }
  let text: string
  try {
    const before = await handle.stat()
    if (!before.isFile()) failure('NOT_REGULAR_FILE')
    if (before.size > DIAGNOSTICS_ANALYSIS_MAX_INPUT_BYTES) failure('INPUT_LIMIT')
    if (!sameContentState(pathBefore, before)) failure('FILE_CHANGED')
    const bytes = Buffer.alloc(DIAGNOSTICS_ANALYSIS_MAX_INPUT_BYTES + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    const after = await handle.stat()
    let pathAfter: FileStat
    try { pathAfter = await io.lstat(filePath) } catch { failure('FILE_CHANGED') }
    if (pathAfter.isSymbolicLink()) failure('SYMLINK_REJECTED')
    if (!pathAfter.isFile() || !after.isFile()) failure('NOT_REGULAR_FILE')
    if (offset > DIAGNOSTICS_ANALYSIS_MAX_INPUT_BYTES
      || before.size > DIAGNOSTICS_ANALYSIS_MAX_INPUT_BYTES
      || after.size > DIAGNOSTICS_ANALYSIS_MAX_INPUT_BYTES) failure('INPUT_LIMIT')
    if (offset !== before.size || !sameContentState(before, after) || !sameContentState(pathBefore, pathAfter)
      || !sameFile(pathAfter, after)) failure('FILE_CHANGED')
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset)) } catch {
      failure('INVALID_UTF8')
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('COPILOT_DIAGNOSTICS_ANALYSIS_')) throw error
    failure('FILE_READ_FAILED')
  } finally {
    try { await handle.close() } catch { failure('FILE_READ_FAILED') }
  }
  return text
}
