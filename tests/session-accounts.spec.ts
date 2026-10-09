import { describe, expect, it } from 'vitest'
import { SessionAccountTurns, parseSessionAccounts, resolveSessionAccount } from '../src/session-accounts.ts'

const personal = '11111111-1111-4111-8111-111111111111'
describe('Session account ownership', () => {
  it('inherits the current global default only when no explicit account exists', () => {
    const preferences = parseSessionAccounts([{ sessionId: 'p', accountId: personal }])
    expect(resolveSessionAccount('w', preferences, 'canonical')).toEqual({ accountId: 'canonical', source: 'global' })
    expect(resolveSessionAccount('w', preferences, personal)).toEqual({ accountId: personal, source: 'global' })
    expect(resolveSessionAccount('p', preferences, 'canonical')).toEqual({ accountId: personal, source: 'session' })
  })
  it('retains explicit same-as-global choices rather than inferring inheritance', () => {
    expect(resolveSessionAccount('w', parseSessionAccounts([{ sessionId: 'w', accountId: 'canonical' }]), personal))
      .toEqual({ accountId: 'canonical', source: 'session' })
  })
  it('rejects malformed, duplicate or oversized preference evidence', () => {
    expect(() => parseSessionAccounts(null)).toThrow('COPILOT_SESSION_ACCOUNTS_INVALID')
    expect(() => parseSessionAccounts([{ sessionId: 'w', accountId: 'bad' }])).toThrow()
    expect(() => parseSessionAccounts([{ sessionId: 'w', accountId: personal }, { sessionId: 'w', accountId: 'canonical' }])).toThrow()
    expect(() => parseSessionAccounts([{ sessionId: 'w', accountId: personal, token: 'not-a-real-secret' }])).toThrow()
  })
  it('freezes each turn across preference changes, steps and retries', () => {
    const turns = new SessionAccountTurns()
    const agent = {}, signal = new AbortController().signal
    const first = turns.admit(agent, 1, signal, { accountId: 'canonical', source: 'global' })
    expect(turns.admit(agent, 1, signal, { accountId: personal, source: 'session' })).toBe(first)
    expect(turns.forSignal(signal)).toEqual(first)
    turns.recordSignal(signal)
    turns.end(agent, 1)
    expect(turns.forSignal(signal)).toBeUndefined()
    expect(turns.admit(agent, 2, new AbortController().signal, { accountId: personal, source: 'session' }).accountId).toBe(personal)
    expect(turns.evidence(agent, 1)).toEqual({ accountId: 'canonical', source: 'global' })
  })
  it('isolates simultaneous Sessions and rejects a changed native signal within a turn', () => {
    const turns = new SessionAccountTurns(), a = {}, b = {}, s = new AbortController().signal
    turns.admit(a, 1, s, { accountId: 'canonical', source: 'global' })
    turns.admit(b, 1, new AbortController().signal, { accountId: personal, source: 'session' })
    expect(turns.current(a)?.accountId).toBe('canonical')
    expect(turns.current(b)?.accountId).toBe(personal)
    expect(() => turns.admit(a, 1, new AbortController().signal, { accountId: personal, source: 'session' }))
      .toThrow('COPILOT_SESSION_ACCOUNT_SIGNAL_CHANGED')
  })
  it('never reconstructs historical account ownership from current selection', () => {
    expect(new SessionAccountTurns().evidence({}, 1)).toBeUndefined()
  })
  it('does not claim account execution when a turn ends before any native delivery', () => {
    const turns = new SessionAccountTurns(), session = {}, signal = new AbortController().signal
    turns.admit(session, 1, signal, { accountId: 'canonical', source: 'global' })
    turns.end(session, 1)
    expect(turns.evidence(session, 1)).toBeUndefined()
  })
  it('retains the first captured identity rather than replacing it with a later lookup', () => {
    const turns = new SessionAccountTurns(), session = {}, signal = new AbortController().signal
    turns.admit(session, 1, signal, { accountId: personal, source: 'session' })
    turns.recordSignal(signal, { login: 'synthetic-first', userId: 1 })
    turns.recordSignal(signal, { login: 'synthetic-later', userId: 2 })
    turns.end(session, 1)
    expect(turns.evidence(session, 1)?.identity).toEqual({ login: 'synthetic-first', userId: 1 })
  })
  it('captures admission identity without claiming delivery and enriches only the active turn', () => {
    const turns = new SessionAccountTurns(), session = {}, signal = new AbortController().signal
    turns.admit(session, 1, signal, { accountId: personal, source: 'session' })
    turns.captureIdentity(signal, { login: 'synthetic-first', userId: 1 })
    expect(turns.evidence(session, 1)).toBeUndefined()
    turns.recordSignal(signal)
    expect(turns.evidence(session, 1)?.identity?.login).toBe('synthetic-first')
    turns.end(session, 1)
    turns.captureIdentity(signal, { login: 'synthetic-later', userId: 2 })
    expect(turns.evidence(session, 1)?.identity?.login).toBe('synthetic-first')
  })
  it('fills missing identity after delivery only while the same turn and signal remain admitted', () => {
    const turns = new SessionAccountTurns(), session = {}, signal = new AbortController().signal
    turns.admit(session, 1, signal, { accountId: personal, source: 'session' })
    turns.recordSignal(signal)
    turns.captureIdentity(signal, { login: 'synthetic-first', userId: 1 })
    expect(turns.evidence(session, 1)).toMatchObject({ accountId: personal, identity: { userId: 1 } })
    turns.end(session, 1)
    const next = new AbortController()
    turns.admit(session, 2, next.signal, { accountId: 'canonical', source: 'global' })
    turns.recordSignal(next.signal)
    turns.captureIdentity(signal, { login: 'synthetic-later', userId: 2 })
    next.abort()
    turns.captureIdentity(next.signal, { login: 'synthetic-later', userId: 2 })
    expect(turns.evidence(session, 2)?.identity).toBeUndefined()
  })
})
