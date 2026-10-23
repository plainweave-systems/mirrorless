// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

// Browser-condition test runners otherwise select Solid's client reactive
// implementation. This isolated file deliberately exercises its SSR build.
vi.mock('solid-js', async () => vi.importActual('solid-js/dist/server.js'))

import { createComponent } from 'solid-js'
import { renderToString } from 'solid-js/web/dist/server.js'
import { createMirrorless } from 'mirrorless'
import { MirrorlessProvider, MirrorlessQuery } from 'mirrorless/solid'

describe('Solid server rendering', () => {
  it('renders initial fallback without starting requests or declaring interest', () => {
    const read = vi.fn(async () => 'Should not run during SSR')
    const runtime = createMirrorless({ query: read, unsubscribeDelayMs: 0 })
    const subscribe = vi.spyOn(runtime, 'subscribe')
    const html = renderToString(() => createComponent(MirrorlessProvider, {
      runtime,
      get children() {
        return createComponent(MirrorlessQuery, {
          id: 'GetTasks', loading: 'Client data loads here', children: (data) => data,
        })
      },
    }))
    expect(html).toContain('Client data loads here')
    expect(read).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    runtime.dispose()
  })
})
