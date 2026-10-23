// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, createServer } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), 'mirrorless-package-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
let server
try {
  const [packed] = JSON.parse(execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8' }))
  const consumer = join(temporary, 'consumer')
  mkdirSync(consumer)
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'mirrorless-isolated-consumer', private: true, type: 'module' }))
  execFileSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(temporary, packed.filename)], { cwd: consumer, stdio: 'pipe' })
  const installed = readdirSync(join(consumer, 'node_modules')).filter(name => !name.startsWith('.'))
  assert.deepEqual(installed, ['mirrorless'], 'Core installation must not pull in optional frameworks or development tooling')
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'
    import { createMirrorless } from 'mirrorless'
    import { bindQuery } from 'mirrorless/dom'
    import { MirrorlessController } from 'mirrorless/lit'
    assert.equal(typeof bindQuery, 'function')
    assert.equal(typeof MirrorlessController, 'function')
    const runtime = createMirrorless({ query: async () => ({ title: 'Artifact, not checkout' }), unsubscribeDelayMs: 0 })
    const subscription = runtime.subscribe('Read')
    await subscription.refetch()
    assert.equal(subscription.getSnapshot().data.title, 'Artifact, not checkout')
    subscription.unsubscribe()
    runtime.dispose()
  `], { cwd: consumer, stdio: 'pipe' })
  console.log('Packed artifact installs and runs in an isolated consumer with zero framework/runtime dependencies.')

  // Svelte ships compiler input, so check the installed artifact rather than
  // only this checkout's self-reference. Supply its optional peer explicitly.
  symlinkSync(join(root, 'node_modules/svelte'), join(consumer, 'node_modules/svelte'), process.platform === 'win32' ? 'junction' : 'dir')
  writeFileSync(join(consumer, 'svelte.config.js'), 'export default {}\n')
  writeFileSync(join(consumer, 'index.html'), '<div id="app"></div><script type="module" src="/main.js"></script>')
  writeFileSync(join(consumer, 'main.js'), "import { mount } from 'svelte'; import App from './App.svelte'; mount(App, { target: document.querySelector('#app') });")
  writeFileSync(join(consumer, 'App.svelte'), `<script>
    import { createMirrorless } from 'mirrorless';
    import { MirrorlessQuery } from 'mirrorless/svelte';
    const runtime = createMirrorless({ query: () => { globalThis.__mirrorlessArtifactReads++; return 42 } });
    </script>
    <MirrorlessQuery id="Read" {runtime}>
      {#snippet children(data)}<p>{data}</p>{/snippet}
      {#snippet loading()}<p>Loading artifact</p>{/snippet}
    </MirrorlessQuery>`)
  writeFileSync(join(consumer, 'entry.js'), "import { render } from 'svelte/server'; import App from './App.svelte'; export function run() { globalThis.__mirrorlessArtifactReads = 0; const result = render(App); return { html: result.body, reads: globalThis.__mirrorlessArtifactReads }; }")
  await build({ root: consumer, configFile: false, plugins: [svelte()], logLevel: 'silent', build: { outDir: join(temporary, 'client') } })
  server = await createServer({ root: consumer, configFile: false, plugins: [svelte()], logLevel: 'silent', server: { middlewareMode: true, hmr: false } })
  const { run } = await server.ssrLoadModule('/entry.js')
  const rendered = run()
  assert.equal(rendered.reads, 0, 'Packed Svelte boundary must not fetch during SSR')
  assert.ok(rendered.html.includes('Loading artifact'))
  console.log('Packed Svelte adapter compiles for the client and SSR-loads without unintended reads.')
} finally {
  await server?.close()
  rmSync(temporary, { recursive: true, force: true })
}
