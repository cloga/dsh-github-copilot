/** Isolated built search-settings fixture; no production API routes or credentials. */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(resolve(root, 'package.json'))
const routes = new Map([
  ['/', { path: resolve(root, 'tests/browser/search-routing.html'), type: 'text/html; charset=utf-8' }],
  ['/readme', { path: resolve(root, 'tests/browser/readme.html'), type: 'text/html; charset=utf-8' }],
  ['/client.js', { path: resolve(root, 'lib/client.js'), type: 'text/javascript; charset=utf-8' }],
  ['/continuation.js', { path: resolve(root, 'artifacts/readme-capture/continuation.js'), type: 'text/javascript; charset=utf-8' }],
  ['/react.js', { path: resolve(dirname(require.resolve('react/package.json')), 'umd/react.development.js'), type: 'text/javascript; charset=utf-8' }],
  ['/react-dom.js', { path: resolve(dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.development.js'), type: 'text/javascript; charset=utf-8' }],
])
const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version
const server = createServer(async (request, response) => {
  const route = routes.get(new URL(request.url, 'http://fixture.invalid').pathname)
  if (request.method !== 'GET' || !route) { response.writeHead(404); response.end(); return }
  try {
    let bytes = await readFile(route.path)
    if (route.path.endsWith('readme.html')) {
      bytes = Buffer.from(bytes.toString('utf8').replaceAll('__CLIENT_VERSION__', version))
    }
    response.writeHead(200, { 'Content-Type': route.type, 'Cache-Control': 'no-store' }); response.end(bytes)
  } catch { response.writeHead(500); response.end('Fixture artifact missing; build the plugin first.') }
})
server.listen(0, '127.0.0.1', () => console.log(`SEARCH_ROUTING_FIXTURE=http://127.0.0.1:${server.address().port}/`))
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close())
