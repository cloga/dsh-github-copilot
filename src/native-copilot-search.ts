import type { Context } from '@deepseek-ai/cordis'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { WebError, type WebSearchProvider } from '@deepseek-ai/dsh-web'
import { createModels } from '@earendil-works/pi-ai'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { createAccountModelSource } from './account-model-source.ts'
import { createGitHubCopilotCredentialStore, normalizeGitHubCopilotOAuthCredential,
  trustedGitHubCopilotBaseUrl } from './copilot-auth.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY } from './copilot-identity.ts'
import { abortable } from './http.ts'
import { captureNativeCopilot, NATIVE_COPILOT } from './native-copilot-access.ts'
import { copilotPublicHeaders } from './preview-provider.ts'
import { onSettingsNamespaceUpdated } from './settings-reader.ts'
import { normalizeSearchResponse } from './traditional-search.ts'

const unavailable = () => new WebError('COPILOT_NATIVE_SEARCH_UNAVAILABLE', 'WEB_PROVIDER_UNAVAILABLE')
const failed = () => new WebError('COPILOT_NATIVE_SEARCH_FAILED', 'WEB_PROVIDER_ERROR')

/** One bounded read; cancellation also releases an uncooperative response reader. */
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.redirected || !response.ok || !response.body) {
    void response.body?.cancel().catch(() => undefined)
    throw failed()
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const part = await abortable(reader.read(), signal)
      signal.throwIfAborted()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > 1024 * 1024) throw failed()
      text += decoder.decode(part.value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally { void reader.cancel().catch(() => undefined) }
}

function hasSearchEvidence(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || !('output' in value) || !Array.isArray(value.output)) return false
  return value.output.some(item => item !== null && typeof item === 'object'
    && item.type === 'web_search_call' && item.status === 'completed')
}

/** Add only a backend to the existing Web service; never select it or replace native tools. */
export function createNativeCopilotSearch(ctx: Context): WebSearchProvider {
  let active = true
  const pending = new Set<AbortController>()
  ctx.effect(() => () => {
    active = false
    for (const controller of pending) controller.abort()
  })
  const revoke = () => { for (const controller of pending) controller.abort() }
  ctx.on('credentials/record-updated', key => { if (key === GITHUB_COPILOT_CREDENTIAL_KEY) revoke() })
  ctx.on('llm/adapters-updated', revoke)
  ctx.on('llm/models-updated', provider => { if (provider === NATIVE_COPILOT) revoke() })
  ctx.effect(() => onSettingsNamespaceUpdated(ctx, revoke))

  return {
    id: 'github-copilot-hosted',
    title: 'GitHub Copilot',
    description: { en: 'Optional Copilot hosted search using the native account. Each search runs one capability probe before the query; both may incur supplier charges.',
      zh: '使用原生账号的可选 Copilot 搜索。每次先执行一次能力探测，再发送查询；两者均可能产生供应商费用。' },
    available: () => active,
    async ready() {
      if (!active) return false
      try {
        const route = await captureNativeCopilot(ctx)
        const record = await ctx.credentials.readRecord(GITHUB_COPILOT_CREDENTIAL_KEY)
        if (!active || !route || record?.kind !== 'grant') return false
        normalizeGitHubCopilotOAuthCredential(record.payload)
        route.assertCurrent()
        return true
      } catch {
        ctx.logger.warn('github-copilot: COPILOT_NATIVE_SEARCH_READINESS_UNAVAILABLE')
        return false
      }
    },
    async search(request, callerSignal) {
      if (callerSignal?.aborted) throw new WebError('web search aborted', 'ABORTED')
      if (!active || pending.size >= 4) throw unavailable()
      if (typeof request.query !== 'string' || request.query.trim().length === 0
        || new TextEncoder().encode(request.query).byteLength > 16384) throw failed()
      const controller = new AbortController()
      const deadline = AbortSignal.timeout(25000)
      const signal = AbortSignal.any([controller.signal, deadline, ...(callerSignal ? [callerSignal] : [])])
      pending.add(controller)
      let disposeSource: (() => void) | undefined
      try {
        const route = await abortable(captureNativeCopilot(ctx), signal)
        if (!route) throw unavailable()
        const check = () => { signal.throwIfAborted(); route.assertCurrent() }
        check()
        const store = createGitHubCopilotCredentialStore(ctx)
        const models = createModels({ credentials: store })
        models.setProvider(githubCopilotProvider())
        const credential = await abortable(store.read(NATIVE_COPILOT), signal)
        if (credential?.type !== 'oauth') throw unavailable()
        const auth = await abortable(models.getAuth(NATIVE_COPILOT), signal)
        check()
        if (!auth?.auth.apiKey) throw unavailable()
        const current = await abortable(store.read(NATIVE_COPILOT), signal)
        check()
        const grant = normalizeGitHubCopilotOAuthCredential(current)
        if (grant.access !== auth.auth.apiKey || grant.expires <= Date.now()) throw unavailable()
        const baseURL = trustedGitHubCopilotBaseUrl(auth.auth.baseUrl, grant)
        const headers = { ...copilotPublicHeaders(), ...attributionHeaders(),
          ...(auth.auth.headers ?? {}), authorization: `Bearer ${auth.auth.apiKey}` }
        const source = createAccountModelSource({
          resolveAuth: async () => ({ apiKey: auth.auth.apiKey!, baseURL,
            accountKey: 'native-canonical-operation', availableModelIds: grant.availableModelIds }),
          assertAuthCurrent: check,
          nativeApis: new Map([...route.models].map(([id, model]) => [id, model.api])),
          headers: copilotPublicHeaders(), timeoutMs: 10000,
        })
        disposeSource = () => source.dispose()
        const catalog = await abortable(source.load({ signal }), signal)
        check()
        const eligible = catalog.models.filter(model => model.api === 'openai-responses'
          && route.models.get(model.id)?.api === 'openai-responses').sort((a, b) => a.id.localeCompare(b.id))
        const model = eligible[0]
        if (!model) throw unavailable()
        const dispatch = async (query: string, probe: boolean) => {
          check()
          const callSignal = probe ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : signal
          const response = await abortable(fetch(`${baseURL}/responses`, {
            method: 'POST', redirect: 'error', signal: callSignal,
            headers: { ...headers, 'content-type': 'application/json', accept: 'application/json',
              'X-Initiator': 'user', 'Openai-Intent': 'conversation-edits' },
            body: JSON.stringify({
              model: model.id, input: [{ role: 'user', content: [{ type: 'input_text', text: query }] }],
              tools: [{ type: 'web_search' }], tool_choice: 'required', stream: false,
              include: ['web_search_call.action.sources'], max_output_tokens: probe ? 64 : Math.min(4096, model.maxTokens),
            }),
          }).then(response => {
            if (callSignal.aborted) { void response.body?.cancel().catch(() => undefined); throw failed() }
            return response
          }), callSignal)
          check()
          const body = await json(response, callSignal)
          check()
          if (!hasSearchEvidence(body)) throw unavailable()
          return body
        }
        await dispatch('Probe web search capability.', true)
        const body = await dispatch(request.query, false)
        return normalizeSearchResponse(body)
      } catch (error) {
        if (callerSignal?.aborted) throw new WebError('web search aborted', 'ABORTED')
        if (controller.signal.aborted || !active) throw unavailable()
        if (deadline.aborted) throw new WebError('web search timed out', 'WEB_PROVIDER_ERROR')
        if (error instanceof WebError) throw error
        throw failed()
      } finally {
        controller.abort()
        disposeSource?.()
        pending.delete(controller)
      }
    },
  }
}
