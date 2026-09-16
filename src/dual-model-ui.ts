/** Optional Models-page entry; feature absence never blocks account sign-in. */
import type { Context } from '@deepseek-ai/cordis'
import { createElement, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type {} from './dual-model-remote.ts'
import { DualModelCard } from './dual-model-card.ts'
import type { SettingsSectionOwnerProps } from './dsh-supported-types.ts'

interface LocaleReader {
  getLocale(): { active: string }
  subscribe(listener: () => void): () => void
}
interface WorkspaceNavigator { openSession(id: string): void }
const emptySubscribe = () => () => {}

function DualModelSurface({ ctx, close }: { ctx: Context; close?: () => void }): ReactElement {
  // These are the public optional Client service faces; no private store or DOM mutation.
  const locale = ctx.get('locale') as LocaleReader | undefined
  const navigation = ctx.get('uiWorkspace') as WorkspaceNavigator | undefined
  const language = useSyncExternalStore(
    locale === undefined ? emptySubscribe : listener => locale.subscribe(listener),
    () => locale?.getLocale().active ?? 'en',
    () => 'en',
  )
  return createElement(DualModelCard, {
    remote: ctx.remote.githubCopilotDualModel,
    locale: language,
    onOpenSession: navigation === undefined ? undefined : (id: string) => {
      navigation.openSession(id)
      close?.()
    },
  })
}

/** A single visible seat under Models, with a section fallback on older Clients. */
export function registerDualModelUi(ctx: Context): () => void {
  if (ctx.remote.githubCopilotDualModel === undefined) return () => {}
  let active = true, footerActive = false, sectionActive = false
  let fallback: (() => void) | undefined
  const syncFallback = () => {
    if (active && sectionActive && !footerActive) {
      fallback ??= ctx.slots.register({
        name: 'settings.section', id: 'github-copilot-dual-model', order: 13, label: 'Copilot · Model roles',
      }, (props: SettingsSectionOwnerProps) => createElement(DualModelSurface, { ctx, close: props.close }))
    } else { fallback?.(); fallback = undefined }
  }
  let footer: () => void = () => {}
  try {
    footer = ctx.slots.inject('settings.models.footer', () => {
      try {
        const spec = ctx.slots.spec?.('settings.models.footer')
        if (spec?.kind !== 'list' || spec.scope !== 'root') return () => {}
        const dispose = ctx.slots.register({
          name: 'settings.models.footer', id: 'github-copilot-dual-model', order: 15,
        }, () => createElement(DualModelSurface, { ctx }))
        footerActive = true
        syncFallback()
        let removed = false
        return () => {
          if (removed) return
          removed = true
          dispose()
          footerActive = false
          syncFallback()
        }
      } catch { ctx.logger.warn('[github-copilot] DUAL_MODEL_FOOTER_UNAVAILABLE'); return () => {} }
    })
  } catch { ctx.logger.warn('[github-copilot] DUAL_MODEL_FOOTER_UNAVAILABLE') }
  const section = ctx.slots.inject('settings.section', () => {
    sectionActive = true
    syncFallback()
    return () => { sectionActive = false; syncFallback() }
  })
  return () => {
    active = false
    footer()
    section()
    fallback?.()
    fallback = undefined
  }
}
