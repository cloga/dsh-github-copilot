import { open } from 'node:fs/promises'
import { basename, isAbsolute, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analyzeReviewedView, analyzeSnapshot, diagnosticsUnitName, parsePersistedUnit, parseReviewedView,
} from '../lib/diagnostics-analysis.js'
import { readBoundedDiagnosticsFile } from '../lib/diagnostics-analysis-io.js'

const usage = 'Usage: node scripts/analyze-diagnostics.mjs --input <absolute-file> --mode persisted-unit --profile-name <name> --output <new-local-file>\n'
  + '   or: node scripts/analyze-diagnostics.mjs --input <absolute-file> --mode reviewed-view --output <new-local-file>'
const supportedErrors = new Set([
  'INVALID_PROFILE', 'INVALID_UNIT', 'INVALID_SNAPSHOT', 'DUPLICATE_AGGREGATE',
  'INVALID_OPTIONS', 'INVALID_VIEW', 'INVALID_ARGUMENTS', 'INPUT_LIMIT', 'INVALID_JSON', 'INVALID_PATH',
  'SYMLINK_REJECTED', 'NOT_REGULAR_FILE', 'FILE_CHANGED', 'FILE_READ_FAILED', 'INVALID_UTF8',
  'INVALID_REPORT', 'OUTPUT_UNAVAILABLE',
])

function parseArguments(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!['--input', '--mode', '--profile-name', '--output'].includes(key)
      || !value || value.startsWith('--') || values.has(key)) {
      throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_ARGUMENTS')
    }
    values.set(key, value)
  }
  const mode = values.get('--mode')
  if (!values.has('--input') || !values.has('--output')
    || !['persisted-unit', 'reviewed-view'].includes(mode)
    || (mode === 'persisted-unit') !== values.has('--profile-name')) {
    throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_ARGUMENTS')
  }
  const input = values.get('--input')
  const output = values.get('--output')
  if (!isAbsolute(input) || !isAbsolute(output))
    throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_PATH')
  const inputPath = resolve(input)
  const outputPath = resolve(output)
  const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value
  if (comparable(inputPath) === comparable(outputPath)
    || (process.platform === 'win32' && parse(outputPath).root.startsWith('\\\\'))) {
    throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_PATH')
  }
  return {
    inputPath, outputPath, mode,
    profileName: values.get('--profile-name'),
  }
}

function errorCode(error) {
  const prefix = 'COPILOT_DIAGNOSTICS_ANALYSIS_'
  if (error instanceof Error && error.message.startsWith(prefix)) {
    const candidate = error.message.slice(prefix.length)
    if (supportedErrors.has(candidate)) return candidate
  }
  return 'ANALYSIS_FAILED'
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(`${usage}\n`)
    return
  }
  const options = parseArguments(args)
  const text = await readBoundedDiagnosticsFile(options.inputPath)
  const observedAt = Date.now()
  let report
  if (options.mode === 'persisted-unit') {
    const unitName = diagnosticsUnitName(options.profileName)
    if (basename(options.inputPath) !== `${unitName}.json`)
      throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_UNIT')
    const snapshot = parsePersistedUnit(text, unitName)
    report = analyzeSnapshot(snapshot, { source: 'persisted-snapshot', observedAt })
  } else {
    report = analyzeReviewedView(parseReviewedView(text), observedAt)
  }
  let handle
  try { handle = await open(options.outputPath, 'wx') } catch {
    throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_OUTPUT_UNAVAILABLE')
  }
  try { await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, 'utf8') } finally { await handle.close() }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`COPILOT_DIAGNOSTICS_ANALYSIS_${errorCode(error)}\n`)
    process.exitCode = 1
  })
}
