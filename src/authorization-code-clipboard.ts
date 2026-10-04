type ClipboardWriter = Pick<Clipboard, 'writeText'>

export async function copyAuthorizationCode(code: string, clipboard?: ClipboardWriter): Promise<void> {
  const writer = clipboard ?? globalThis.navigator?.clipboard
  if (writer === undefined) throw new Error('Clipboard access is unavailable')
  await writer.writeText(code)
}
