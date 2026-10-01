/** Native OAuth ownership and the sole plugin-owned, account-discovered route. */
export const GITHUB_COPILOT_CREDENTIAL_KEY = 'llm-pi-ai/github-copilot'
export const GITHUB_COPILOT_PROVIDER_ID = 'github-copilot'
export const GITHUB_COPILOT_PREVIEW_PROVIDER_ID = 'github-copilot-preview'
export const GITHUB_COPILOT_PREVIEW_MODEL_ID = 'gpt-6-astra'
export const GITHUB_COPILOT_AUTO_MODEL_ID = 'auto'
export const GITHUB_COPILOT_AUTO_EFFICIENCY_MODEL_ID = 'auto-efficiency'
export const GITHUB_COPILOT_AUTO_INTELLIGENCE_MODEL_ID = 'auto-intelligence'

export type AutoModelPreference = 'efficiency' | 'balance' | 'intelligence'

export function autoModelPreference(model: string): AutoModelPreference | undefined {
  if (model === GITHUB_COPILOT_AUTO_MODEL_ID) return 'balance'
  if (model === GITHUB_COPILOT_AUTO_EFFICIENCY_MODEL_ID) return 'efficiency'
  if (model === GITHUB_COPILOT_AUTO_INTELLIGENCE_MODEL_ID) return 'intelligence'
  return undefined
}
