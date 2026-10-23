// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))

describe('Svelte server rendering', () => {
  it('compiles the distributed boundary for SSR and performs no reads during render', () => {
    // Run server-compiled source under Node's server conditions, independently
    // of the browser resolution needed by client component integration tests.
    const program = String.raw`
      import { compile } from 'svelte/compiler'
      import { render } from 'svelte/server'
      import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
      import { join, resolve } from 'node:path'
      import { pathToFileURL } from 'node:url'
      import { createMirrorless } from 'mirrorless'

      const adapter = resolve('src/svelte')
      const directory = mkdtempSync(join(adapter, '.ssr-test-'))
      let calls = 0
      const runtime = createMirrorless({ query: async () => { calls += 1; return 'unexpected' } })
      try {
        const source = readFileSync(join(adapter, 'MirrorlessQuery.svelte'), 'utf8')
        const compiled = compile(source, { filename: join(adapter, 'MirrorlessQuery.svelte'), generate: 'server' })
        const code = compiled.js.code.replace(/from (['"])\.\/([^'"]+)\1/g, (_match, _quote, relative) =>
          'from ' + JSON.stringify(pathToFileURL(join(adapter, relative)).href))
        const filename = join(directory, 'query.mjs')
        writeFileSync(filename, code)
        const { default: Query } = await import(pathToFileURL(filename).href)
        const result = render(Query, { props: { runtime, id: 'Read', params: { id: 1 } } })
        console.log(JSON.stringify({ calls, rendered: typeof result.body === 'string' }))
      } finally {
        runtime.dispose()
        rmSync(directory, { recursive: true, force: true })
      }
    `
    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', program], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20_000,
    })
    expect(JSON.parse(stdout.trim())).toEqual({ calls: 0, rendered: true })
  })
})
