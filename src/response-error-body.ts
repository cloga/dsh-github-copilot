const maxErrorBytes = 8 * 1024
const errorReadTimeoutMs = 250

async function readError(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0, chunks = 0, text = ''
  while (true) {
    // Empty resolved chunks can starve timers; bound work as well as bytes.
    if (chunks++ > maxErrorBytes) return undefined
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > maxErrorBytes) return undefined
    text += decoder.decode(chunk.value, { stream: true })
  }
  return JSON.parse(text + decoder.decode())
}

/** Optional classification evidence only; an unreadable clone leaves native handling unchanged. */
export async function readResponseErrorJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) return undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    const clone = response.clone()
    if (!clone.body) return undefined
    reader = clone.body.getReader()
    const interrupted = new Promise<undefined>(resolve => {
      onAbort = () => resolve(undefined)
      signal?.addEventListener('abort', onAbort, { once: true })
      timeout = setTimeout(() => resolve(undefined), errorReadTimeoutMs)
      if (signal?.aborted) resolve(undefined)
    })
    const result = await Promise.race([readError(reader), interrupted])
    return signal?.aborted ? undefined : result
  } catch {
    return undefined
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    if (reader) {
      // Tee cancellation may await the untouched native branch; never await it.
      try { void reader.cancel().catch(() => {}) } catch { /* Already closed/errored. */ }
      try { reader.releaseLock() } catch { /* A pending read still owns the lock. */ }
    }
  }
}
