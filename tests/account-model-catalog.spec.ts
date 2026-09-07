import { describe, expect, it } from 'vitest'
import { ACCOUNT_MODEL_CATALOG_LIMITS, normalizeAccountModelCatalog } from '../src/account-model-catalog.ts'

// Synthetic API fixtures only: these prove normalization, not live discovery,
// account authorization, endpoint availability, or successful model transport.
function model(id = 'future-lab-r17', endpoints = ['/responses']): Record<string, unknown> {
  return {
    id,
    name: `Display ${id}`,
    model_picker_enabled: true,
    policy: { state: 'enabled' },
    supported_endpoints: endpoints,
    capabilities: {
      limits: { max_context_window_tokens: 128_000, max_prompt_tokens: 96_000, max_output_tokens: 16_000 },
      supports: { streaming: true, tool_calls: true, vision: false },
    },
  }
}
function catalog(...models: unknown[]) { return { data: models } }
function capabilities(value: Record<string, unknown>) {
  return value.capabilities as { limits: Record<string, unknown>; supports: Record<string, unknown> }
}
function first(value: unknown, options?: Parameters<typeof normalizeAccountModelCatalog>[1]) {
  const result = normalizeAccountModelCatalog(value, options)
  expect(result.rejected).toEqual([])
  expect(result.models).toHaveLength(1)
  return result.models[0]!
}

describe('account model catalog normalization (synthetic API fixtures)', () => {
  it.each([
    ['/responses', 'openai-responses'],
    ['/chat/completions', 'openai-completions'],
    ['/v1/messages', 'anthropic-messages'],
  ])('routes an unseen identifier using %s rather than its model name', (endpoint, api) => {
    const result = first(catalog(model('future-lab-r17', [endpoint])))
    expect(result).toMatchObject({ id: 'future-lab-r17', api, input: ['text'], evidence: { selectedEndpoint: endpoint, apiSource: 'advertised-priority' } })
  })

  it('uses advertised Responses when an older local catalog says GPT-6 is Completions', () => {
    const result = first(catalog(model('gpt-6-astra')), { nativeApis: new Map([['gpt-6-astra', 'openai-completions']]) })
    expect(result.api).toBe('openai-responses')
    expect(result.evidence.apiSource).toBe('advertised-priority')
  })

  it('accepts new Gemini and Sol Fast IDs without adding model-specific rules', () => {
    const result = normalizeAccountModelCatalog(catalog(
      model('gemini-3.8-flash', ['/chat/completions']),
      model('gpt-5.6-sol-fast', ['/responses']),
    ))
    expect(result.rejected).toEqual([])
    expect(result.models.map(value => [value.id, value.api])).toEqual([
      ['gemini-3.8-flash', 'openai-completions'], ['gpt-5.6-sol-fast', 'openai-responses'],
    ])
  })

  it('prefers native API only when the server advertises the matching endpoint', () => {
    const raw = catalog(model('future-lab-r17', ['/responses', '/v1/messages', '/chat/completions']))
    expect(first(raw).api).toBe('anthropic-messages')
    expect(first(raw, { nativeApis: new Map([['future-lab-r17', 'openai-completions']]) }))
      .toMatchObject({ api: 'openai-completions', evidence: { apiSource: 'advertised-native' } })
    expect(first(raw, { nativeApis: new Map([['future-lab-r17', 'unknown-native-api']]) }).api).toBe('anthropic-messages')
  })

  it('keeps only safe endpoint evidence and never extracts supplied URLs, headers, or secrets', () => {
    const value = model('future-lab-r17', ['/responses', 'https://untrusted.invalid/?secret=PRIVATE', '/future?secret=PRIVATE'])
    for (const key of ['baseURL', 'baseUrl', 'headers', 'credential', 'token']) {
      Object.defineProperty(value, key, { enumerable: true, get() { throw new Error('PRIVATE EXTRA FIELD WAS READ') } })
    }
    Object.defineProperty(value.capabilities, 'secret', { enumerable: true, get() { throw new Error('PRIVATE CAPABILITY WAS READ') } })
    Object.defineProperty(capabilities(value).supports, 'secret', { enumerable: true, get() { throw new Error('PRIVATE SUPPORT WAS READ') } })
    const output = first(catalog(value))
    expect(output.evidence.endpoints).toEqual(['/responses'])
    expect(output.evidence.unsupportedEndpointCount).toBe(2)
    expect(JSON.stringify(output)).not.toMatch(/PRIVATE|untrusted|baseURL|credential|headers/)
  })

  it('preserves context, input and output limits as different facts', () => {
    const result = first(catalog(model()))
    expect(result).toMatchObject({ contextWindow: 128_000, maxInputTokens: 96_000, maxTokens: 16_000, evidence: { contextWindowSource: 'max_context_window_tokens' } })
  })

  it('falls back to the prompt limit only when the context field is absent and records that source', () => {
    const value = model()
    delete capabilities(value).limits.max_context_window_tokens
    expect(first(catalog(value))).toMatchObject({ contextWindow: 96_000, maxInputTokens: 96_000, evidence: { contextWindowSource: 'max_prompt_tokens' } })
  })

  it('does not invent an input limit when only a context window was supplied', () => {
    const value = model()
    delete capabilities(value).limits.max_prompt_tokens
    expect(first(catalog(value))).not.toHaveProperty('maxInputTokens')
  })

  it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '128000', null, undefined])('rejects invalid context limit %j rather than falling back', invalid => {
    const value = model()
    capabilities(value).limits.max_context_window_tokens = invalid
    const result = normalizeAccountModelCatalog(catalog(value))
    expect(result.models).toEqual([])
    expect(result.rejected).toEqual([{ id: 'future-lab-r17', code: 'INVALID_LIMITS' }])
  })

  it.each(['max_context_window_tokens', 'max_output_tokens'])('does not invent the required %s', key => {
    const value = model()
    delete capabilities(value).limits[key]
    if (key === 'max_context_window_tokens') delete capabilities(value).limits.max_prompt_tokens
    const result = normalizeAccountModelCatalog(catalog(value))
    expect(result.models).toEqual([])
    expect(result.rejected[0]?.code).toBe(key === 'max_output_tokens' ? 'MISSING_OUTPUT_LIMIT' : 'MISSING_CONTEXT_LIMIT')
  })

  it.each([
    ['picker', 'PICKER_DISABLED'], ['streaming', 'STREAMING_UNSUPPORTED'], ['tools', 'TOOLS_UNSUPPORTED'],
    ['disabled', 'POLICY_NOT_ENABLED'], ['unconfigured', 'POLICY_NOT_ENABLED'], ['future-policy-state', 'POLICY_NOT_ENABLED'],
  ])('does not open a model with %s', (condition, code) => {
    const value = model()
    if (condition === 'picker') value.model_picker_enabled = false
    else if (condition === 'streaming') capabilities(value).supports.streaming = false
    else if (condition === 'tools') capabilities(value).supports.tool_calls = false
    else value.policy = { state: condition }
    expect(normalizeAccountModelCatalog(catalog(value), { availableModelIds: new Set(['future-lab-r17']) }))
      .toEqual({ models: [], rejected: [{ id: 'future-lab-r17', code }] })
  })

  it('uses a caller-proven account ID only for an absent policy and records the evidence source', () => {
    const value = model()
    delete value.policy
    expect(normalizeAccountModelCatalog(catalog(value)).rejected).toEqual([{ id: 'future-lab-r17', code: 'MISSING_POLICY' }])
    expect(normalizeAccountModelCatalog(catalog(value), { availableModelIds: new Set(['different-id']) }).models).toEqual([])
    expect(first(catalog(value), { availableModelIds: new Set(['future-lab-r17']) }).evidence.policySource).toBe('account-available-id')
    expect(first(catalog(model())).evidence.policySource).toBe('server-enabled')
  })

  it.each([
    value => { value.model_picker_enabled = 'true' },
    value => { capabilities(value).supports.streaming = 'true' },
    value => { capabilities(value).supports.tool_calls = 1 },
    value => { capabilities(value).supports.vision = 'true' },
    value => { value.policy = { state: true } },
    value => { value.policy = {} },
    value => { value.policy = null },
  ] satisfies Array<(value: Record<string, unknown>) => void>)('rejects malformed gate types without truthiness coercion', mutate => {
    const value = model()
    mutate(value)
    expect(normalizeAccountModelCatalog(catalog(value), { availableModelIds: new Set(['future-lab-r17']) }).models).toEqual([])
  })

  it.each([
    [undefined, 'MISSING_ENDPOINTS'], [[], 'MISSING_ENDPOINTS'], [['ws:/responses'], 'WEBSOCKET_ONLY'],
    [['/future-only'], 'UNSUPPORTED_ENDPOINTS'], [['https://untrusted.invalid/responses'], 'UNSUPPORTED_ENDPOINTS'],
    [['/responses', 1], 'INVALID_ENDPOINTS'], ['/responses', 'INVALID_ENDPOINTS'],
  ])('refuses missing or unsupported endpoint metadata %j', (endpoints, code) => {
    const value = model()
    value.supported_endpoints = endpoints
    expect(normalizeAccountModelCatalog(catalog(value), { nativeApis: new Map([['future-lab-r17', 'openai-responses']]) }))
      .toEqual({ models: [], rejected: [{ id: 'future-lab-r17', code }] })
  })

  it('keeps reasoning labels as advertised data and identifies unfamiliar labels without blocking default calls', () => {
    const value = model()
    Object.assign(capabilities(value).supports, { reasoning_effort: ['high', 'experimental-depth', 'low', 'high'], adaptive_thinking: true, min_thinking_budget: 1024, max_thinking_budget: 32768 })
    expect(first(catalog(value)).reasoning).toEqual({
      advertisedEfforts: ['experimental-depth', 'high', 'low'], unmappedEfforts: ['experimental-depth'],
      adaptiveThinking: true, minThinkingBudget: 1024, maxThinkingBudget: 32768,
    })
    expect(first(catalog(model())).reasoning).toEqual({ advertisedEfforts: [], unmappedEfforts: [] })
  })

  it('does not manufacture high, max, or off when only an unfamiliar effort is advertised', () => {
    const value = model()
    capabilities(value).supports.reasoning_effort = ['future-depth']
    const reasoning = first(catalog(value)).reasoning
    expect(reasoning.advertisedEfforts).toEqual(['future-depth'])
    expect(reasoning.unmappedEfforts).toEqual(['future-depth'])
    expect(reasoning).not.toHaveProperty('thinkingLevelMap')
  })

  it.each([
    { reasoning_effort: [false] }, { reasoning_effort: 'high' }, { adaptive_thinking: 'yes' },
    { min_thinking_budget: 100, max_thinking_budget: 10 }, { max_thinking_budget: Infinity },
  ])('rejects malformed reasoning metadata %j', extra => {
    const value = model()
    Object.assign(capabilities(value).supports, extra)
    expect(normalizeAccountModelCatalog(catalog(value)).models).toEqual([])
  })

  it('advertises image input only from the vision flag and preserves bounded MIME evidence', () => {
    const value = model()
    capabilities(value).supports.vision = true
    capabilities(value).limits.vision = { supported_media_types: ['image/png', 'image/jpeg', 'image/png'] }
    expect(first(catalog(value))).toMatchObject({ input: ['text', 'image'], evidence: { visionMediaTypes: ['image/jpeg', 'image/png'] } })
    const textOnly = model()
    Object.defineProperty(capabilities(textOnly).limits, 'vision', { get() { throw new Error('Unused vision detail was read') } })
    expect(first(catalog(textOnly)).input).toEqual(['text'])
  })

  it('keeps image support when valid document media types accompany image types', () => {
    const value = model()
    capabilities(value).supports.vision = true
    capabilities(value).limits.vision = { supported_media_types: ['application/pdf', 'IMAGE/PNG', 'text/plain', 'image/jpeg'] }
    const output = first(catalog(value))
    expect(output.input).toEqual(['text', 'image'])
    expect(output.evidence.visionMediaTypes).toEqual(['image/jpeg', 'image/png'])
    expect(JSON.stringify(output)).not.toMatch(/application\/pdf|text\/plain/)
  })

  it('keeps a text model available without claiming images when only document media types are explicit', () => {
    const value = model()
    capabilities(value).supports.vision = true
    capabilities(value).limits.vision = { supported_media_types: ['application/pdf', 'text/plain'] }
    const output = first(catalog(value))
    expect(output.input).toEqual(['text'])
    expect(output.evidence.visionMediaTypes).toEqual([])
    expect(Object.isFrozen(output.evidence.visionMediaTypes)).toBe(true)
  })

  it('uses the explicit vision flag when no media type list was supplied', () => {
    const value = model()
    capabilities(value).supports.vision = true
    expect(first(catalog(value)).input).toEqual(['text', 'image'])
    capabilities(value).limits.vision = {}
    const output = first(catalog(value))
    expect(output.input).toEqual(['text', 'image'])
    expect(output.evidence).not.toHaveProperty('visionMediaTypes')
  })

  it.each([[], ['image/png', 'https://untrusted.invalid/?secret=PRIVATE'], ['image/png?secret=PRIVATE'], ['not-a-mime'], ['image/'], [false]]
    .map(mediaTypes => ({ mediaTypes })))('rejects empty or malformed media metadata without copying URLs: $mediaTypes', ({ mediaTypes }) => {
    const value = model()
    capabilities(value).supports.vision = true
    capabilities(value).limits.vision = { supported_media_types: mediaTypes }
    const output = normalizeAccountModelCatalog(catalog(value))
    expect(output).toEqual({ models: [], rejected: [{ id: 'future-lab-r17', code: 'INVALID_VISION_LIMITS' }] })
    expect(JSON.stringify(output)).not.toContain('PRIVATE')
  })

  it('deduplicates equal IDs but rejects all versions of a conflicting duplicate', () => {
    const a = model()
    expect(first(catalog(a, structuredClone(a))).id).toBe('future-lab-r17')
    const changed = model()
    capabilities(changed).limits.max_output_tokens = 8000
    const result = normalizeAccountModelCatalog(catalog(a, changed, structuredClone(a)))
    expect(result.models).toEqual([])
    expect(result.rejected).toEqual([{ id: 'future-lab-r17', code: 'DUPLICATE_CONFLICT' }])
  })

  it.each([true, false])('invalidates a duplicate ID even when its disabled record occurs first=%s', disabledFirst => {
    const disabled = model()
    disabled.policy = { state: 'disabled' }
    const enabled = model()
    const result = normalizeAccountModelCatalog(catalog(...(disabledFirst ? [disabled, enabled] : [enabled, disabled])))
    expect(result.models).toEqual([])
    expect(result.rejected.some(entry => entry.id === 'future-lab-r17' && entry.code === 'DUPLICATE_CONFLICT')).toBe(true)
  })

  it('normalizes only owned data and freezes all nested public output', () => {
    const value = model()
    capabilities(value).supports.reasoning_effort = ['high']
    const result = normalizeAccountModelCatalog(catalog(value))
    const output = result.models[0]!
    for (const part of [result, result.models, result.rejected, output, output.input, output.reasoning, output.reasoning.advertisedEfforts, output.reasoning.unmappedEfforts, output.evidence, output.evidence.endpoints]) {
      expect(Object.isFrozen(part)).toBe(true)
    }
    capabilities(value).limits.max_context_window_tokens = 1
    ;(value.supported_endpoints as string[]).push('/v1/messages')
    expect(output.contextWindow).toBe(128_000)
    expect(output.evidence.endpoints).toEqual(['/responses'])
  })

  it('does not invoke accessors even on required fields and emits only safe diagnostic data', () => {
    const value = model()
    Object.defineProperty(value, 'supported_endpoints', { get() { throw new Error('PRIVATE VALUE') } })
    const result = normalizeAccountModelCatalog(catalog(value))
    expect(result.models).toEqual([])
    expect(result.rejected).toEqual([{ id: 'future-lab-r17', code: 'UNREADABLE_FIELD' }])
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })

  it.each(['', 'has\ncontrol', 'has\u202Econtrol', 'x'.repeat(201)])('rejects unsafe or oversized IDs without echoing them: %j', id => {
    const result = normalizeAccountModelCatalog(catalog(model(id)))
    expect(result.models).toEqual([])
    expect(result.rejected).toEqual([{ code: 'INVALID_ID' }])
  })

  it('can use the identifier as a display name only when the name is absent', () => {
    const value = model()
    delete value.name
    expect(first(catalog(value)).name).toBe('future-lab-r17')
    value.name = false
    expect(normalizeAccountModelCatalog(catalog(value)).models).toEqual([])
  })

  it('bounds raw JSON bytes, collection length, endpoint counts and known string sizes', () => {
    expect(normalizeAccountModelCatalog(' '.repeat(ACCOUNT_MODEL_CATALOG_LIMITS.maxBytes + 1))).toEqual({ models: [], rejected: [{ code: 'CATALOG_TOO_LARGE' }] })
    expect(normalizeAccountModelCatalog(catalog(...Array.from({ length: ACCOUNT_MODEL_CATALOG_LIMITS.maxModels + 1 }, () => model())))).toEqual({ models: [], rejected: [{ code: 'TOO_MANY_MODELS' }] })
    expect(normalizeAccountModelCatalog(catalog(model('future-lab-r17', Array.from({ length: ACCOUNT_MODEL_CATALOG_LIMITS.maxEndpoints + 1 }, () => '/responses')))).models).toEqual([])
    const value = model()
    value.name = 'x'.repeat(ACCOUNT_MODEL_CATALOG_LIMITS.maxNameLength + 1)
    expect(normalizeAccountModelCatalog(catalog(value)).models).toEqual([])
  })

  it('measures raw UTF-8 bytes rather than only UTF-16 string length', () => {
    const raw = JSON.stringify({ data: [], extra: '🚀'.repeat(600_000) })
    expect(raw.length).toBeLessThan(ACCOUNT_MODEL_CATALOG_LIMITS.maxBytes)
    expect(normalizeAccountModelCatalog(raw)).toEqual({ models: [], rejected: [{ code: 'CATALOG_TOO_LARGE' }] })
  })

  it('rejects the entire object catalog when its known-field work budget is exhausted', () => {
    const rows = Array.from({ length: ACCOUNT_MODEL_CATALOG_LIMITS.maxModels }, (_, index) => {
      const value = model(`budget-${index}`, ['/responses', ...Array.from({ length: 15 }, (_, part) => `/future-${part}-${'x'.repeat(100)}`)])
      value.name = '漢'.repeat(256)
      capabilities(value).supports.vision = true
      capabilities(value).supports.reasoning_effort = Array.from({ length: 32 }, (_, part) => `effort-${part}-${'x'.repeat(50)}`)
      capabilities(value).limits.vision = { supported_media_types: Array.from({ length: 32 }, (_, part) => `image/${'a'.repeat(110)}${part}`) }
      return value
    })
    expect(normalizeAccountModelCatalog(catalog(...rows))).toEqual({ models: [], rejected: [{ code: 'CATALOG_TOO_LARGE' }] })
  })

  it('does not invoke array element accessors', () => {
    const value = model()
    const endpoints = ['/responses']
    Object.defineProperty(endpoints, '0', { get() { throw new Error('PRIVATE ARRAY VALUE') } })
    value.supported_endpoints = endpoints
    expect(normalizeAccountModelCatalog(catalog(value))).toEqual({ models: [], rejected: [{ id: 'future-lab-r17', code: 'UNREADABLE_FIELD' }] })
  })

  it('accepts bounded JSON text but rejects malformed top-level input without throwing', () => {
    expect(first(JSON.stringify(catalog(model()))).id).toBe('future-lab-r17')
    for (const invalid of [null, [], 1, { data: false }, {}]) {
      expect(normalizeAccountModelCatalog(invalid)).toEqual({ models: [], rejected: [{ code: 'INVALID_CATALOG' }] })
    }
    expect(normalizeAccountModelCatalog('{')).toEqual({ models: [], rejected: [{ code: 'INVALID_JSON' }] })
  })
})
