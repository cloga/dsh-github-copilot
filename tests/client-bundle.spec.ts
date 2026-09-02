// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'

const PLUGIN_ID = 'dsh-github-copilot'

interface Handoff {
  id: string
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

interface ModuleLoaderWindow {
  __ModuleLoader__?: {
    load(handoff: Handoff): void
  }
}

afterEach(() => {
  delete (window as ModuleLoaderWindow).__ModuleLoader__
})

describe('tsdown client artifact', () => {
  function loadArtifact(): { handoff: Handoff; exports: Record<string, unknown>; requested: string[] } {
    const code = readFileSync(resolve('lib/client.js'), 'utf8')
    let handoff: Handoff | undefined
    ;(window as ModuleLoaderWindow).__ModuleLoader__ = {
      load(value) {
        handoff = value
      },
    }
    new Function(code)()
    expect(handoff).toBeDefined()

    const modules = new Map<string, unknown>([
      ['react', React],
      ['@deepseek-ai/cordis', {}],
      ['@deepseek-ai/dsh-api-remotes/client', {}],
      ['@deepseek-ai/dsh-client-ui-renderer/client', {}],
      ['@deepseek-ai/dsh-client-ui-slots', {}],
    ])
    const requested: string[] = []
    const exports = handoff!.factory((specifier) => {
      requested.push(specifier)
      if (!modules.has(specifier)) throw new Error(`unexpected require: ${specifier}`)
      return modules.get(specifier)
    })
    return { handoff: handoff!, exports, requested }
  }

  it('hands off the built client with the exact plugin id and injected require', () => {
    const { handoff, requested } = loadArtifact()

    expect(handoff.id).toBe(PLUGIN_ID)
    expect(requested).toEqual(['react'])
  })

  it('materializes the built client apply and inject exports', () => {
    const { exports } = loadArtifact()

    expect(exports.apply).toBeTypeOf('function')
    expect(exports.inject).toEqual(['remote', 'slots'])
  })
})
