/**
 * Unit tests for the shared HTTP preflight helper: the cancellation race must
 * settle promptly, and an operation the caller walked away from (pre-aborted
 * signal) must keep being observed so a late rejection cannot become
 * unhandled.
 */

import { describe, expect, it } from 'vitest'
import { abortable } from '../../src/http.ts'

describe('abortable', () => {
  it('resolves with the operation value when the signal never fires', async () => {
    const signal = new AbortController().signal
    await expect(abortable(Promise.resolve('ok'), signal)).resolves.toBe('ok')
  })

  it('rejects when the signal fires before the operation settles', async () => {
    const controller = new AbortController()
    const promise = abortable(new Promise<string>(() => undefined), controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(abortable(new Promise<string>(() => undefined), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('keeps observing a late operation rejection after the pre-aborted branch', async () => {
    const controller = new AbortController()
    controller.abort()
    let rejectLate: ((error: Error) => void) | undefined
    const operation = new Promise<string>((_resolve, reject) => { rejectLate = reject })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      await expect(abortable(operation, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
      rejectLate?.(new Error('late rejection'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(unhandled).toHaveLength(0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
