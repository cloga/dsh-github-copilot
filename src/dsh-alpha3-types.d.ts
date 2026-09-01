/**
 * Type augmentations for the public extension contracts introduced by DSH
 * 0.1.2-alpha.3. The declarations mirror the upstream slot owner shape while
 * runtime values continue to come from the host installation.
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'

export {}

export interface ProviderCardExtrasOwnerProps {
  readonly provider: {
    readonly provider: string
    readonly displayName: string
    readonly settingsNs: string
  }
  readonly configured: boolean
  readonly keyConfigured: boolean
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.models.provider-card': {
      kind: 'keyed'
      scope: 'root'
      owner: ProviderCardExtrasOwnerProps
    }
    'settings.models.footer': {
      kind: 'list'
      scope: 'root'
      owner: { children?: never }
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    systemPrompt: {
      section(entry: { name: string; order?: number; text: () => string }): () => void
    }
    slots: {
      inject(name: string, callback: () => unknown): unknown
      register(
        options: { name: string; key?: string },
        component: (props: ProviderCardExtrasOwnerProps) => ReactNode,
      ): () => void
    }
  }
}
