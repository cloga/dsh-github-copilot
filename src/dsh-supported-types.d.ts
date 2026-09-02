/**
 * Type augmentations for the DSH client contracts used across the supported
 * 0.1.1-rc.2 and 0.1.2-alpha.4 baselines. Runtime values continue to come from
 * the host installation.
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

export interface SettingsSectionOwnerProps {
  readonly close: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.section': {
      kind: 'list'
      scope: 'root'
      owner: SettingsSectionOwnerProps
    }
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
      inject(name: string, callback: () => unknown): () => void
      register(
        options: { name: 'settings.models.provider-card'; key: string },
        component: (props: ProviderCardExtrasOwnerProps) => ReactNode,
      ): () => void
      register(
        options: { name: 'settings.section'; id: string; order?: number; label: string },
        component: (props: SettingsSectionOwnerProps) => ReactNode,
      ): () => void
    }
  }
}
