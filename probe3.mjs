import { readFileSync } from 'node:fs'
const raw = readFileSync('/home/yms/.dsh/.credentials.yaml', 'utf8')
const key = raw.split('\n').find(l => /^DEEPSEEK_API_KEY\s*:/.test(l)).replace(/^DEEPSEEK_API_KEY\s*:\s*/, '').trim()
const model = 'deepseek-v4-flash'

async function probe(label, tools, toolChoice) {
  const res = await fetch('https://api.deepseek.com/responses', {
    method: 'POST', redirect: 'error',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ model, input: [{ role: 'user', content: [{ type: 'input_text', text: 'Probe web search capability.' }] }], tools, tool_choice: toolChoice, stream: false, max_output_tokens: 64 }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) return `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
  const body = await res.json()
  const types = (body.output ?? []).map(i => i.type).join(',')
  return `200, output types: [${types || 'none'}]`
}

console.log('deepseek web_search+name      :', await probe(1, [{ type: 'web_search', name: 'web_search' }], { type: 'web_search' }))
console.log('deepseek web_search_2025_08_26:', await probe(2, [{ type: 'web_search_2025_08_26' }], { type: 'web_search_2025_08_26' }))
