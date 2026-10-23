// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Component, StrictMode, act, createElement as h, memo, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { createMirrorless } from '../../src/core/index.js'
import {
  MirrorlessLoadingSpinner,
  MirrorlessProvider,
  MirrorlessQuery,
  useMirrorlessQuery,
  useMirrorlessRuntime,
} from '../../src/react/index.js'

const roots = new Set()
const runtimes = new Set()
let previousActEnvironment

beforeAll(() => {
  previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})
afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount()
  })
  roots.clear()
  for (const runtime of runtimes) runtime.dispose()
  runtimes.clear()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function runtime(options = {}) {
  const value = createMirrorless({ unsubscribeDelayMs: 0, ...options })
  runtimes.add(value)
  return value
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function mount(element) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.add(root)
  act(() => root.render(element))
  return {
    container,
    render(next) { act(() => root.render(next)) },
    unmount() {
      if (!roots.delete(root)) return
      act(() => root.unmount())
    },
  }
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

function provide(value, children) {
  return h(MirrorlessProvider, { runtime: value }, children)
}

class ErrorBoundary extends Component {
  state = { error: undefined }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    return this.state.error
      ? h('p', { role: 'alert' }, String(this.state.error.message ?? this.state.error))
      : this.props.children
  }
}

describe('React Mirrorless adapter', () => {
  it('renders loading as its own hook-using component, then passes only plain data', async () => {
    const waiting = deferred()
    const query = vi.fn(() => waiting.promise)
    const value = runtime({ query })
    const loadingCleanup = vi.fn()
    const renderer = vi.fn((data) => h('output', null, data.title))
    function Loading() {
      const [message] = useState('Waiting for the server')
      useEffect(() => loadingCleanup, [])
      return h('p', { role: 'status' }, message)
    }
    const view = mount(provide(value, h(MirrorlessQuery, { id: 'GetTask', loading: Loading }, renderer)))
    expect(view.container.textContent).toBe('Waiting for the server')
    expect(renderer).not.toHaveBeenCalled()
    await act(async () => { waiting.resolve({ title: 'Confirmed' }) })
    expect(view.container.textContent).toBe('Confirmed')
    expect(renderer.mock.calls.every((args) => args.length === 1)).toBe(true)
    expect(renderer.mock.lastCall[0]).toEqual({ title: 'Confirmed' })
    expect(Object.isFrozen(renderer.mock.lastCall[0])).toBe(true)
    expect(loadingCleanup).toHaveBeenCalledTimes(1)
  })

  it.each([null, false, 0, [], ''])('treats %j as available data rather than loading', async (data) => {
    const value = runtime({ query: async () => data })
    const rendered = vi.fn((result) => h('output', null, JSON.stringify(result)))
    const view = mount(provide(value, h(MirrorlessQuery, { id: 'Read', loading: () => h('p', null, 'loading') }, rendered)))
    await settle()
    expect(rendered).toHaveBeenCalled()
    expect(rendered.mock.lastCall).toEqual([data])
    expect(view.container.textContent).toBe(JSON.stringify(data))
  })

  it('sends an initial failure to the nearest React error boundary by default', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('read denied')
    const value = runtime({ query: async () => { throw failure } })
    const view = mount(h(ErrorBoundary, null,
      provide(value, h(MirrorlessQuery, { id: 'Read' }, () => h('p', null, 'unreachable'))),
    ))
    await settle()
    expect(view.container.querySelector('[role="alert"]').textContent).toBe('read denied')
  })

  it('renders a local memoized error component with its own hooks and snapshot', async () => {
    const value = runtime({ query: async () => { throw new Error('local failure') } })
    let received
    const ErrorMessage = memo(function ErrorMessage(snapshot) {
      received = snapshot
      const [prefix] = useState('Handled: ')
      return h('p', { role: 'alert' }, prefix + snapshot.error.message)
    })
    const view = mount(provide(value, h(MirrorlessQuery, { id: 'Read', error: ErrorMessage }, () => null)))
    await settle()
    expect(view.container.textContent).toBe('Handled: local failure')
    expect(received.status).toBe('error')
    expect(received.data).toBeUndefined()
    expect(typeof received.refetch).toBe('function')
  })

  it('supports element loading content and the render-prop alias', async () => {
    const waiting = deferred()
    const value = runtime({ query: () => waiting.promise })
    const view = mount(provide(value, h(MirrorlessQuery, {
      id: 'Read',
      loading: h('span', null, 'An element'),
      render: (data) => h('output', null, data),
    })))
    expect(view.container.textContent).toBe('An element')
    await act(async () => { waiting.resolve('Done') })
    expect(view.container.textContent).toBe('Done')
  })

  it('shares one active fetch between independently mounted consumers', async () => {
    const waiting = deferred()
    const query = vi.fn(() => waiting.promise)
    const value = runtime({ query })
    const view = mount(provide(value, h('section', null,
      h(MirrorlessQuery, { id: 'Read', params: { id: 'a' } }, (data) => h('output', null, data)),
      h(MirrorlessQuery, { id: 'Read', params: { id: 'a' } }, (data) => h('output', null, data)),
    )))
    await settle()
    expect(query).toHaveBeenCalledTimes(1)
    await act(async () => { waiting.resolve('Shared') })
    expect([...view.container.querySelectorAll('output')].map((node) => node.textContent)).toEqual(['Shared', 'Shared'])
  })

  it('does not churn observers for value-equal inline params or equal options', async () => {
    const query = vi.fn(async () => 'value')
    const value = runtime({ query })
    const observed = vi.spyOn(value, 'observe')
    function Probe({ unrelated }) {
      const read = useMirrorlessQuery('Read', { filter: { done: false }, ids: ['a'] }, { kind: 'component' })
      return h('output', null, `${unrelated}:${read.data ?? 'loading'}`)
    }
    const view = mount(provide(value, h(Probe, { unrelated: 1 })))
    await settle()
    view.render(provide(value, h(Probe, { unrelated: 2 })))
    view.render(provide(value, h(Probe, { unrelated: 3 })))
    expect(observed).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledTimes(1)
    expect(view.container.textContent).toBe('3:value')
  })

  it('compares JSON-normalized params so optional undefined fields do not churn', async () => {
    const value = runtime({ query: vi.fn(), unsubscribeDelayMs: 100 })
    const observed = vi.spyOn(value, 'observe')
    function Probe({ count }) {
      const read = useMirrorlessQuery('Read', { id: 'a', optional: undefined }, { fetch: false })
      return h('output', null, `${count}:${read.status}`)
    }
    const view = mount(provide(value, h(Probe, { count: 1 })))
    await settle()
    view.render(provide(value, h(Probe, { count: 2 })))
    expect(observed).toHaveBeenCalledTimes(1)
  })

  it('honors the runtime value equality when stabilizing parameters', async () => {
    const lowerStrings = (_key, value) => typeof value === 'string' ? value.toLowerCase() : value
    const equal = (a, b) => JSON.stringify(a, lowerStrings) === JSON.stringify(b, lowerStrings)
    const query = vi.fn(async (_name, params) => params.id)
    const value = runtime({ query, equal })
    const observed = vi.spyOn(value, 'observe')
    function Probe({ id }) {
      const read = useMirrorlessQuery('Read', { id })
      return h('output', null, read.data ?? 'loading')
    }
    const view = mount(provide(value, h(Probe, { id: 'a' })))
    await settle()
    view.render(provide(value, h(Probe, { id: 'A' })))
    expect(observed).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledTimes(1)
    expect(view.container.textContent).toBe('a')
  })

  it('never presents the previous term data during the first render of a new term', async () => {
    const second = deferred()
    const value = runtime({ query: (_id, params) => params.id === 'a' ? Promise.resolve({ id: 'a' }) : second.promise })
    const frames = []
    function Probe({ id }) {
      const read = useMirrorlessQuery('GetTask', { id })
      frames.push({ requested: id, params: read.params.id, data: read.data?.id })
      return h('output', null, read.data?.id ?? 'loading')
    }
    const view = mount(provide(value, h(Probe, { id: 'a' })))
    await settle()
    expect(view.container.textContent).toBe('a')
    view.render(provide(value, h(Probe, { id: 'b' })))
    expect(view.container.textContent).toBe('loading')
    expect(frames.filter((frame) => frame.requested === 'b').every((frame) => frame.params === 'b' && frame.data !== 'a')).toBe(true)
    await act(async () => { second.resolve({ id: 'b' }) })
    expect(view.container.textContent).toBe('b')
  })

  it('uses a frozen parameter copy so caller mutations are detected on a later render', async () => {
    const query = vi.fn(async (_id, params) => params.id)
    const value = runtime({ query })
    const params = { id: 'a' }
    function Probe() {
      const read = useMirrorlessQuery('Read', params)
      return h('output', null, read.data ?? 'loading')
    }
    const view = mount(provide(value, h(Probe)))
    await settle()
    params.id = 'b'
    view.render(provide(value, h(Probe)))
    await settle()
    expect(view.container.textContent).toBe('b')
    expect(query).toHaveBeenCalledTimes(2)
    expect(Object.isFrozen(params)).toBe(false)
  })

  it('does not display a prior runtime value after an identity/runtime change', async () => {
    const first = runtime({ query: async () => 'first user' })
    const waiting = deferred()
    const second = runtime({ query: () => waiting.promise })
    const content = () => h(MirrorlessQuery, { id: 'CurrentUser', loading: () => h('span', null, 'new session') }, (data) => h('output', null, data))
    const view = mount(provide(first, content()))
    await settle()
    expect(view.container.textContent).toBe('first user')
    view.render(provide(second, content()))
    expect(view.container.textContent).toBe('new session')
    await act(async () => { waiting.resolve('second user') })
    expect(view.container.textContent).toBe('second user')
  })

  it('keeps existing data visible during a refresh and after a refresh failure', async () => {
    const refresh = deferred()
    const query = vi.fn().mockResolvedValueOnce('confirmed').mockImplementationOnce(() => refresh.promise)
    const value = runtime({ query })
    let read
    function Probe() {
      read = useMirrorlessQuery('Read')
      return h('output', null, `${read.data ?? 'loading'}:${read.loading}:${read.error?.message ?? ''}`)
    }
    const view = mount(provide(value, h(Probe)))
    await settle()
    let request
    act(() => { request = read.refetch() })
    expect(view.container.textContent).toBe('confirmed:true:')
    await act(async () => {
      refresh.reject(new Error('offline'))
      await request.catch(() => {})
    })
    expect(view.container.textContent).toBe('confirmed:false:offline')
    expect(read.ready).toBe(true)
  })

  it('keeps the success boundary mounted on background errors', async () => {
    const query = vi.fn().mockResolvedValueOnce('confirmed').mockRejectedValueOnce(new Error('refresh failed'))
    const value = runtime({ query })
    let latest
    function Success({ data }) {
      latest = useMirrorlessQuery('Read')
      return h('output', null, data)
    }
    const localError = vi.fn(() => h('span', null, 'error'))
    const view = mount(provide(value, h(MirrorlessQuery, { id: 'Read', error: localError }, (data) => h(Success, { data }))))
    await settle()
    await act(async () => { await latest.refetch().catch(() => {}) })
    expect(view.container.textContent).toBe('confirmed')
    expect(localError).not.toHaveBeenCalled()
  })

  it('cleans listeners through StrictMode replay and final unmount', async () => {
    const waiting = deferred()
    const query = vi.fn(() => waiting.promise)
    const value = runtime({ query, unsubscribeDelayMs: 100 })
    const observe = value.observe.bind(value)
    let listeners = 0
    vi.spyOn(value, 'observe').mockImplementation((...args) => {
      const source = observe(...args)
      return {
        getSnapshot: () => source.getSnapshot(),
        refetch: () => source.refetch(),
        subscribe(listener) {
          const stop = source.subscribe(listener)
          listeners += 1
          return () => { listeners -= 1; stop() }
        },
      }
    })
    const render = vi.fn((data) => h('output', null, data))
    const view = mount(h(StrictMode, null, provide(value, h(MirrorlessQuery, { id: 'Read' }, render))))
    await settle()
    expect(query).toHaveBeenCalledTimes(1)
    expect(listeners).toBe(1)
    await act(async () => { waiting.resolve('ready') })
    expect(view.container.textContent).toBe('ready')
    view.unmount()
    expect(listeners).toBe(0)
  })

  it('respects fetch:false and starts when that subscription option changes', async () => {
    const query = vi.fn(async () => 'started')
    const value = runtime({ query })
    function Probe({ enabled }) {
      const read = useMirrorlessQuery('Read', {}, { fetch: enabled })
      return h('output', null, read.data ?? 'idle')
    }
    const view = mount(provide(value, h(Probe, { enabled: false })))
    await settle()
    expect(query).not.toHaveBeenCalled()
    view.render(provide(value, h(Probe, { enabled: true })))
    await settle()
    expect(query).toHaveBeenCalledTimes(1)
    expect(view.container.textContent).toBe('started')
  })

  it('does not fetch or declare interest during server rendering', () => {
    const query = vi.fn(async () => 'never')
    const value = runtime({ query })
    const subscribe = vi.spyOn(value, 'subscribe')
    const html = renderToString(provide(value, h(MirrorlessQuery, {
      id: 'Read', loading: () => h('p', null, 'loading shell'),
    }, (data) => h('output', null, data))))
    expect(html).toContain('loading shell')
    expect(query).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('requires a provider unless the hook receives an explicit runtime', () => {
    function Missing() { useMirrorlessRuntime(); return null }
    expect(() => renderToString(h(Missing))).toThrow(/MirrorlessProvider/)
    const value = runtime({ query: vi.fn() })
    function Explicit() {
      const read = useMirrorlessQuery('Read', {}, { runtime: value })
      return h('span', null, read.status)
    }
    expect(renderToString(h(Explicit))).toContain('idle')
  })

  it('ships a stylesheet-independent, non-animated accessible web indicator', () => {
    const html = renderToString(h(MirrorlessLoadingSpinner, { label: 'Reading' }))
    expect(html).toContain('role="status"')
    expect(html).toContain('Reading')
    expect(html).not.toContain('animate-')
    expect(html).not.toContain('animation:')
  })
})
