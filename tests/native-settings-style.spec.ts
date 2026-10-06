import { describe, expect, it } from 'vitest'
import { nativeSettingsStyle, nativeButtonStyle, nativeCompactButtonStyle, nativeInputStyle, nativeSettingsCss } from '../src/native-settings-style.ts'
import { nativeSelectStyle } from '../src/native-select-style.ts'

describe('native settings presentation', () => {
  it('uses the published DSH settings type scale and theme-owned family', () => {
    expect(nativeSettingsStyle).toMatchObject({
      fontFamily: 'var(--dsw-font-family, system-ui)',
      fontSize: 14, lineHeight: '22px', fontWeight: 400,
    })
    expect(nativeButtonStyle).toMatchObject({ minHeight: 36, fontSize: 14, lineHeight: '22px', padding: '0 14px' })
    expect(nativeCompactButtonStyle).toMatchObject({ minHeight: 28, fontSize: 12, lineHeight: '18px', padding: '0 10px' })
    expect(nativeInputStyle).toMatchObject({ minHeight: 32, fontSize: 14, lineHeight: '22px' })
    expect(nativeSelectStyle()).toMatchObject(nativeInputStyle)
  })

  it('scopes interaction states and disclosure typography to plugin-owned roots', () => {
    expect(nativeSettingsCss).toContain('[data-copilot-native-ui]')
    expect(nativeSettingsCss).toContain(':focus-visible')
    expect(nativeSettingsCss).toContain(':disabled')
    expect(nativeSettingsCss).toContain('summary')
    expect(nativeSettingsCss).toContain('prefers-reduced-motion')
    expect(nativeSettingsCss).not.toContain('!important')
    expect(nativeSettingsCss).not.toMatch(/(^|\n)\s*(body|html|:root)\s*[,{]/)
  })
})
