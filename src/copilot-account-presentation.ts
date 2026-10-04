const listeners = new Set<() => void>()
let pending = 0

/** Invalidation only: account data and credentials never travel between surfaces. */
export const accountPresentationChanges = {
  pending: () => pending > 0,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  begin(): () => void {
    pending++
    for (const listener of listeners) listener()
    let finished = false
    return () => {
      if (finished) return
      finished = true
      pending--
      for (const listener of listeners) listener()
    }
  },
}
