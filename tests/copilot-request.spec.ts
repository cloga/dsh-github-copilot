import { describe, expect, it } from 'vitest'
import { providerRequestHeaders } from '../src/copilot-request.ts'
import { makeCandidate } from './helpers.ts'

describe('Copilot request headers', () => {
  it('combines installed catalog headers with provider-required request metadata', () => {
    expect(providerRequestHeaders(makeCandidate('openai-responses', {
      baseURL: 'https://api.individual.githubcopilot.com',
      headers: {
        'User-Agent': 'GitHubCopilotChat/0.35.0',
        'Editor-Version': 'vscode/1.107.0',
        Removed: null,
      },
    }), 'agent')).toEqual({
      'User-Agent': 'GitHubCopilotChat/0.35.0',
      'Editor-Version': 'vscode/1.107.0',
      'X-Initiator': 'agent',
      'Openai-Intent': 'conversation-edits',
    })
  })

  it('does not add Copilot metadata to another provider endpoint', () => {
    expect(providerRequestHeaders(makeCandidate('openai-responses'), 'user')).toEqual({})
  })

  it('applies a credential-specific Copilot endpoint before request construction', async () => {
    const { applyRequestAuth } = await import('../src/copilot-request.ts')
    expect(applyRequestAuth(makeCandidate('openai-responses'), {
      apiKey: 'not-exposed',
      baseURL: 'https://api.business.githubcopilot.com',
    }).baseURL).toBe('https://api.business.githubcopilot.com')
  })

  it('preserves the Anthropic v1 path on a credential-specific endpoint', async () => {
    const { applyRequestAuth } = await import('../src/copilot-request.ts')
    expect(applyRequestAuth(makeCandidate('anthropic-messages'), {
      apiKey: 'not-exposed',
      baseURL: 'https://api.business.githubcopilot.com',
    }).baseURL).toBe('https://api.business.githubcopilot.com/v1')
  })

  it('adds dynamic headers for business and enterprise Copilot endpoints', () => {
    expect(providerRequestHeaders(makeCandidate('openai-responses', {
      baseURL: 'https://api.business.githubcopilot.com',
    }), 'user')).toMatchObject({
      'X-Initiator': 'user',
      'Openai-Intent': 'conversation-edits',
    })
    expect(providerRequestHeaders(makeCandidate('openai-responses', {
      baseURL: 'https://copilot-api.company.ghe.com',
    }), 'user')).toMatchObject({
      'X-Initiator': 'user',
      'Openai-Intent': 'conversation-edits',
    })
  })
})
