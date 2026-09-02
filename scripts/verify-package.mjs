import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (packageJson.dependencies?.['@deepseek-ai/dsh-authorization'] === undefined) {
  throw new Error('package must install the rc.2 authorization bootstrap dependency')
}
if (packageJson.dependencies?.zod === undefined) {
  throw new Error('package must install the strict Remote codec runtime dependency')
}

for (const [subpath, target] of Object.entries(packageJson.exports ?? {})) {
  if (typeof target === 'string') {
    await access(resolve(root, target))
    continue
  }
  for (const path of Object.values(target)) await access(resolve(root, path))
  if (!('types' in target) || !('default' in target)) {
    throw new Error(`package export ${subpath} must expose both types and default`)
  }
}

for (const entry of ['lib/index.js', 'lib/client.js', 'lib/remote.js']) {
  await access(resolve(root, entry))
}

const clientCode = await readFile(resolve(root, 'lib/client.js'), 'utf8')
let handoff
vm.runInNewContext(clientCode, {
  window: {
    __ModuleLoader__: {
      load(value) {
        handoff = value
      },
    },
  },
})
if (handoff?.id !== packageJson.name || typeof handoff.factory !== 'function') {
  throw new Error('built client must register the package id through window.__ModuleLoader__.load')
}
const react = await import('react')
const clientExports = handoff.factory((specifier) => {
  if (specifier === 'react') return react
  throw new Error(`built client requested undeclared loader external: ${specifier}`)
})
if (typeof clientExports.apply !== 'function' || !Array.isArray(clientExports.inject)) {
  throw new Error('built client must materialize apply and inject exports')
}

const remote = (await import(pathToFileURL(resolve(root, 'lib/remote.js')).href)).default
if (remote.descriptors.length !== 4) {
  throw new Error('built Remote entry must expose all four authorization methods')
}
for (const descriptor of remote.descriptors) {
  if (descriptor.invocation.kind !== 'direct' || descriptor.parameters.length !== 0) {
    throw new Error(`built Remote ${descriptor.namespace}/${descriptor.method} must remain a no-parameter direct call`)
  }
  if (
    descriptor.result.mode !== 'strict'
    || descriptor.result.typeSymbol !== 'dsh-github-copilot#GitHubCopilotAuthorizationView'
    || typeof descriptor.result.schema?.parse !== 'function'
  ) {
    throw new Error(`built Remote ${descriptor.namespace}/${descriptor.method} must expose the strict authorization view codec`)
  }
}

console.log('Verified built host, client, remote, type, and metadata package exports.')
