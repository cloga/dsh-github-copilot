import { z } from 'zod'

export const AUTO_MODEL_INTENT_PROJECTION = 'githubCopilotAutoModelIntent'
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const selectionSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) }).strict()
export const AutoModelIntentSchema = z.object({
  inherited: count,
  selection: selectionSchema.nullable(),
  blocked: z.boolean(),
}).strict()
export type AutoModelIntent = z.infer<typeof AutoModelIntentSchema>

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function initialAutoModelIntent(inherited = 0): AutoModelIntent {
  return { inherited, selection: null, blocked: false }
}

/** Request headers describe execution, not replacement of an explicit picker intent. */
export function foldAutoModelIntent(state: AutoModelIntent, event: unknown): AutoModelIntent {
  if (!record(event) || event.type !== 'model/selection') return state
  if (!Number.isSafeInteger(event.seq) || Number(event.seq) < 0) {
    return { ...state, selection: null, blocked: true }
  }
  // Copied fork/child prefixes do not prove an explicit choice by their new owner.
  if (Number(event.seq) < state.inherited) return state
  const data = event.data
  const parsed = selectionSchema.safeParse(record(data) ? { provider: data.provider, model: data.model } : data)
  return parsed.success
    ? { ...state, selection: parsed.data, blocked: false }
    : { ...state, selection: null, blocked: true }
}

export const autoModelIntentDefinition = {
  key: AUTO_MODEL_INTENT_PROJECTION,
  stateVersion: 1,
  stateSchema: AutoModelIntentSchema,
  init: (_header: unknown, inherited = 0) => initialAutoModelIntent(inherited),
  apply: foldAutoModelIntent,
}
