/**
 * Idle watchdog for the inline wire path: aborts when no data arrives for a
 * configurable interval. The timeout resets on every `reset()` call, so a
 * slow but alive stream never trips it.
 * @module dsh-web-search-provider/watchdog
 */

/** Abort-triggering idle timer. */
export class IdleWatchdog {
  readonly signal: AbortSignal
  private readonly controller = new AbortController()
  private timer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param ms - the idle bound in milliseconds.
   */
  constructor(private readonly ms: number) {
    this.signal = this.controller.signal
    this.reset()
  }

  /** Restart the idle window. Call after every received event. */
  reset(): void {
    if (this.controller.signal.aborted) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.controller.abort(), this.ms)
  }

  /** Stop the timer and release the signal. */
  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }
}
