// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import { createMirrorless, sameValue } from 'mirrorless'
import SvelteQueryFixture from './fixtures/SvelteQueryFixture.svelte'
import SvelteBoundaryFixture from './fixtures/SvelteBoundaryFixture.svelte'
import SvelteContextFixture from './fixtures/SvelteContextFixture.svelte'

const mounted = []

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function renderFixture(runtime, props = {}, Component = SvelteQueryFixture) {
  const target = document.createElement('div')
  document.body.append(target)
  const component = mount(Component, { target, props: { runtime, ...props } })
  mounted.push({ component, runtime, target })
  flushSync()
  return { component, target }
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
  await tick()
  flushSync()
}

afterEach(async () => {
  for (const { component, runtime, target } of mounted.splice(0).reverse()) {
    await unmount(component)
    runtime.dispose()
    target.remove()
  }
})

describe('Svelte data boundary', () => {
  it('renders first loading, then passes the actual plain result to the success snippet', async () => {
    const pending = deferred()
    const query = vi.fn(() => pending.promise)
    const runtime = createMirrorless({ query, unsubscribeDelayMs: 0 })
    const captures = []
    const { target } = renderFixture(runtime, { onData: ({ data }) => captures.push(data) })
    expect(target.querySelector('[role="status"]')?.textContent).toBe('Loading')
    expect(query).toHaveBeenCalledTimes(1)
    const result = { title: 'From the server' }
    pending.resolve(result)
    await settle()
    expect(target.querySelector('output')?.textContent).toBe(JSON.stringify(result))
    expect(target.querySelector('[role="status"]')).toBeNull()
    expect(captures.at(-1)).toBe(result)
    expect(Object.isFrozen(captures.at(-1))).toBe(true)
  })

  it.each([null, false, 0, []])('treats %j as successful data rather than first loading', async (data) => {
    const runtime = createMirrorless({ query: async () => data, unsubscribeDelayMs: 0 })
    const { target } = renderFixture(runtime)
    await settle()
    expect(target.querySelector('output')?.textContent).toBe(JSON.stringify(data))
    expect(target.querySelector('[role="status"]')).toBeNull()
  })

  it.each([
    [{ filter: undefined }, {}],
    [{ filter: [undefined] }, { filter: [null] }],
  ])('renders success for JSON-normalized params %j', async (params, normalized) => {
    const query = vi.fn(async () => 42)
    const runtime = createMirrorless({ query, unsubscribeDelayMs: 0 })
    const { target } = renderFixture(runtime, { params })
    await settle()
    expect(query.mock.calls[0][1]).toEqual(normalized)
    expect(target.querySelector('output')?.textContent).toBe('42')
    expect(target.querySelector('[role="status"]')).toBeNull()
  })

  it.each([{ filter: undefined }, { filter: [undefined] }])(
    'renders first failure for JSON-normalized params %j',
    async (params) => {
      const runtime = createMirrorless({
        query: async () => { throw new Error('Normalized optional error') },
        unsubscribeDelayMs: 0,
      })
      const { target } = renderFixture(runtime, { params })
      await settle()
      expect(target.querySelector('[role="alert"]')?.textContent).toBe('Normalized optional error')
      expect(target.querySelector('[role="status"]')).toBeNull()
    },
  )

  it('renders a shared run when its params differ under the configured equality', async () => {
    const equal = (a, b) => {
      const lower = (value) => JSON.parse(JSON.stringify(value).toLowerCase())
      return sameValue(lower(a), lower(b))
    }
    const query = vi.fn(async () => 42)
    const runtime = createMirrorless({ query, equal, unsubscribeDelayMs: 0 })
    const first = renderFixture(runtime, { params: { id: 'TASK' } })
    await settle()
    const second = renderFixture(runtime, { params: { id: 'task' } })
    await settle()
    expect(first.target.querySelector('output')?.textContent).toBe('42')
    expect(second.target.querySelector('output')?.textContent).toBe('42')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('does not churn when new params match under the configured equality', async () => {
    const equal = (a, b) => JSON.stringify(a).toLowerCase() === JSON.stringify(b).toLowerCase()
    const query = vi.fn(async () => 42)
    const runtime = createMirrorless({ query, equal, unsubscribeDelayMs: 0 })
    const observe = vi.spyOn(runtime, 'observe')
    const { component, target } = renderFixture(runtime, { params: { id: 'TASK' } })
    await settle()
    flushSync(() => component.setQuery('Read', { id: 'task' }))
    await settle()
    expect(target.querySelector('output')?.textContent).toBe('42')
    expect(observe).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('renders local first-value failure and never calls the success snippet', async () => {
    const failure = new Error('Read failed')
    const captures = vi.fn()
    const runtime = createMirrorless({ query: async () => { throw failure }, unsubscribeDelayMs: 0 })
    const { target } = renderFixture(runtime, { onData: captures })
    await settle()
    expect(target.querySelector('[role="alert"]')?.textContent).toBe('Read failed')
    expect(captures).not.toHaveBeenCalled()
  })

  it('propagates an unhandled first-value failure to a Svelte error boundary', async () => {
    const runtime = createMirrorless({
      query: async () => { throw new Error('Caught by Svelte') },
      unsubscribeDelayMs: 0,
    })
    const { target } = renderFixture(runtime, {}, SvelteBoundaryFixture)
    await settle()
    expect(target.querySelector('[data-testid="boundary"]')?.textContent).toBe('Boundary: Caught by Svelte')
  })

  it('keeps confirmed data on screen throughout refresh and a background error', async () => {
    const refresh = deferred()
    const data = { title: 'Confirmed' }
    const query = vi.fn()
      .mockResolvedValueOnce(data)
      .mockImplementationOnce(() => refresh.promise)
    const runtime = createMirrorless({
      query, updates: { Refresh: ['Read'] }, virtualCommands: ['Refresh'], unsubscribeDelayMs: 0,
    })
    const { target } = renderFixture(runtime)
    await settle()
    const command = runtime.command('Refresh')
    await settle()
    expect(target.querySelector('output')?.textContent).toBe(JSON.stringify(data))
    expect(target.querySelector('[role="status"]')).toBeNull()
    refresh.reject(new Error('Offline'))
    await command
    await settle()
    expect(target.querySelector('output')?.textContent).toBe(JSON.stringify(data))
    expect(target.querySelector('[role="alert"]')).toBeNull()
  })

  it('does not show a previous term while changing params or accept its later completion', async () => {
    const second = deferred()
    const firstData = { id: 1 }
    const query = vi.fn((_name, params) => params.id === 1 ? Promise.resolve(firstData) : second.promise)
    const runtime = createMirrorless({ query, unsubscribeDelayMs: 0 })
    const captures = []
    const { target, component } = renderFixture(runtime, {
      params: { id: 1 }, onData: (value) => captures.push(value),
    })
    await settle()
    expect(target.querySelector('output')?.textContent).toBe('{"id":1}')
    flushSync(() => component.setQuery('Read', { id: 2 }))
    expect(target.querySelector('output')).toBeNull()
    expect(captures.some(({ params, data }) => params.id === 2 && data?.id === 1)).toBe(false)
    second.resolve({ id: 2 })
    await settle()
    expect(target.querySelector('output')?.textContent).toBe('{"id":2}')
  })

  it('does not churn for new value-equal parameter objects', async () => {
    const query = vi.fn(async (_name, params) => params)
    const runtime = createMirrorless({ query, unsubscribeDelayMs: 0 })
    const observe = vi.spyOn(runtime, 'observe')
    const { component } = renderFixture(runtime, { params: { id: 1, filter: { done: false } } })
    await settle()
    flushSync(() => component.setQuery('Read', { filter: { done: false }, id: 1 }))
    await settle()
    expect(query).toHaveBeenCalledTimes(1)
    expect(observe).toHaveBeenCalledTimes(1)
  })

  it('isolates data when the runtime changes with an otherwise identical term', async () => {
    const firstRuntime = createMirrorless({ query: async () => 'first identity', unsubscribeDelayMs: 0 })
    const pending = deferred()
    const secondRuntime = createMirrorless({ query: () => pending.promise, unsubscribeDelayMs: 0 })
    const { component, target } = renderFixture(firstRuntime)
    await settle()
    flushSync(() => component.setRuntime(secondRuntime))
    expect(target.querySelector('output')).toBeNull()
    pending.resolve('second identity')
    await settle()
    expect(target.querySelector('output')?.textContent).toBe('"second identity"')
    secondRuntime.dispose()
  })

  it('uses the contextual runtime without a global singleton', async () => {
    const runtime = createMirrorless({ query: async () => 'context value', unsubscribeDelayMs: 0 })
    const seen = vi.fn()
    const { target } = renderFixture(runtime, { onRuntime: seen }, SvelteContextFixture)
    await settle()
    expect(seen).toHaveBeenCalledWith(runtime)
    expect(target.querySelector('output')?.textContent).toBe('"context value"')
  })

  it('shares identical read work between separately mounted components', async () => {
    const query = vi.fn(async () => 'shared')
    const runtime = createMirrorless({ query, unsubscribeDelayMs: 0 })
    const first = renderFixture(runtime, { params: { id: 1 } })
    const second = renderFixture(runtime, { params: { id: 1 } })
    await settle()
    expect(first.target.querySelector('output')?.textContent).toBe('"shared"')
    expect(second.target.querySelector('output')?.textContent).toBe('"shared"')
    expect(query).toHaveBeenCalledTimes(1)
  })
})
