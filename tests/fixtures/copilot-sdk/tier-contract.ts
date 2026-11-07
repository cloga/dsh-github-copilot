import type { CopilotClient } from '@github/copilot-sdk'
// CI copies the production mapper here; this fixture never constructs an SDK client.
import { mapHydraFusionDescriptors } from './hydrafusion-descriptors.ts'

type Session = Awaited<ReturnType<CopilotClient['createSession']>>
type ModelList = Awaited<ReturnType<Session['rpc']['model']['list']>>
type Tier = NonNullable<NonNullable<ModelList['auto']>['tiers']>[number]
type Status = NonNullable<Tier['status']>
type Expect<T extends true> = T
type IsKnown<T> = 0 extends (1 & T) ? false : [T] extends [never] ? false : unknown extends T ? false : true
type IsFunction<T> = IsKnown<T> extends true ? T extends (...args: infer _Args) => unknown ? true : false : false
type _KnownId = Expect<IsKnown<Tier['id']>>
type _KnownDisplayName = Expect<IsKnown<Tier['displayName']>>
type _KnownType = Expect<IsKnown<Tier['type']>>
type _KnownEnabled = Expect<IsKnown<Status['enabled']>>
type _KnownPickerVisible = Expect<IsKnown<Status['pickerVisible']>>
type _SetAutoTier = Expect<IsFunction<Session['setAutoTier']>>
type _SwitchAutoTier = Expect<IsFunction<Session['rpc']['model']['switchAutoTier']>>

const id: Tier['id'] = 'opaque-sdk-fixture-tier'
const displayName: Tier['displayName'] = 'Synthetic Fusion tier'
const type: Tier['type'] = 'fusion'
const enabled: Status['enabled'] = true
const pickerVisible: Status['pickerVisible'] = true

const result = mapHydraFusionDescriptors({
  auto: { tiers: [{ id, displayName, type, status: { enabled, pickerVisible } }] },
})
if (result.status !== 'ready' || result.truncated || result.descriptors.length !== 1
  || result.descriptors[0]?.id !== id || result.descriptors[0]?.displayName !== displayName) {
  throw new Error('SDK_TIER_DESCRIPTOR_FIXTURE_MISMATCH')
}

console.log('Public SDK tier field types and synthetic descriptor mapping checked; no SDK session was started.')
