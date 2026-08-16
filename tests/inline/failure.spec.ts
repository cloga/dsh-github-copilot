/**
 * Classification tests: HTTP statuses and transport errors map onto the
 * harness failure vocabulary that dsh-llm-retry understands.
 */

import { describe, expect, it } from 'vitest'
import { classifyHttpStatus, classifyWireError, parseRetryAfterMs } from '../../src/failure.ts'

describe('classifyHttpStatus', () => {
  it('maps 401 and 403 to AUTH', () => {
    expect(classifyHttpStatus(401).code).toBe('AUTH')
    expect(classifyHttpStatus(403).code).toBe('AUTH')
  })

  it('maps 429 to RATE_LIMIT and carries retry-after', () => {
    const failure = classifyHttpStatus(429, 5, 'req-1')
    expect(failure.code).toBe('RATE_LIMIT')
    expect(failure.providerRetryAfterMs).toBe(5)
    expect(failure.requestId).toBe('req-1')
  })

  it('names the API family passed as label', () => {
    expect(classifyHttpStatus(500).message).toContain('Responses API')
    expect(classifyHttpStatus(500, undefined, undefined, 'Messages API').message).toBe('Messages API error (HTTP 500)')
  })

  it('maps 400 to INVALID_REQUEST', () => {
    expect(classifyHttpStatus(400).code).toBe('INVALID_REQUEST')
  })

  it('maps 408 to TIMEOUT', () => {
    expect(classifyHttpStatus(408).code).toBe('TIMEOUT')
  })

  it('maps 5xx to SERVER', () => {
    expect(classifyHttpStatus(500).code).toBe('SERVER')
    expect(classifyHttpStatus(503).code).toBe('SERVER')
  })

  it('maps anything else to UNKNOWN', () => {
    expect(classifyHttpStatus(418).code).toBe('UNKNOWN')
  })
})

describe('parseRetryAfterMs', () => {
  it('parses a seconds value into milliseconds', () => {
    expect(parseRetryAfterMs('5')).toBe(5000)
  })

  it('ignores absent, invalid, and HTTP-date values', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined()
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT')).toBeUndefined()
    expect(parseRetryAfterMs('-3')).toBeUndefined()
    expect(parseRetryAfterMs('soon')).toBeUndefined()
  })
})

describe('classifyWireError', () => {
  it('maps timeout language to TIMEOUT', () => {
    expect(classifyWireError(new Error('fetch timed out after 300s')).code).toBe('TIMEOUT')
  })

  it('maps network language to TRANSPORT', () => {
    expect(classifyWireError(new Error('fetch failed: ECONNREFUSED')).code).toBe('TRANSPORT')
    expect(classifyWireError(new Error('socket hang up')).code).toBe('TRANSPORT')
  })

  it('maps quota language to QUOTA', () => {
    expect(classifyWireError(new Error('quota exceeded for model deepseek-v4-flash')).code).toBe('QUOTA')
  })

  it('maps context window language to CONTEXT_WINDOW_EXCEEDED', () => {
    expect(classifyWireError(new Error('context window exceeded')).code).toBe('CONTEXT_WINDOW_EXCEEDED')
  })

  it('defaults to UNKNOWN', () => {
    expect(classifyWireError(new Error('mysterious failure')).code).toBe('UNKNOWN')
  })
})
