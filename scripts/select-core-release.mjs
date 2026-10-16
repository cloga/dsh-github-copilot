import { readFile } from 'node:fs/promises'
import { selectCoreRelease } from './release-policy.mjs'

try {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/select-core-release.mjs <exact DSH Core version>')
  const baseline = JSON.parse(await readFile(new URL('../deployment-baseline.json', import.meta.url), 'utf8'))
  console.log(JSON.stringify(selectCoreRelease(baseline, process.argv[2])))
} catch (error) {
  console.error(`Release selection: ${error.message}`)
  process.exitCode = 1
}
