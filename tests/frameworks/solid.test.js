// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createComponent, createMemo, createRoot, createSignal, ErrorBoundary } from 'solid-js'
import { render } from 'solid-js/web'
import { createMirrorless } from 'mirrorless'
import {
  MirrorlessProvider,
  MirrorlessQuery,
  useMirrorlessQuery,
  useMirrorlessRuntime,
} from 'mirrorless/solid'

const cleanups = []

function runtimeFor(options = {}) {
  const runtime = createMirrorless({ unsubscribeDelayMs: 0, ...options })
  cleanups.push(() => runtime.dispose())
  return runtime
}

function root(callback) {
  return createRoot((dispose) => {
    cleanups.push(dispose)
    return callback(dispose)
  })
}

function mount(component) {
  const element = document.createElement('div')
  document.body.append(element)
  const dispose = render(component, element)
  cleanups.push(() => { dispose(); element.remove() })
  return { element, dispose }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

function provider(runtime, children) {
  return createComponent(MirrorlessProvider, {
    runtime,
    get children() { return children() },
  })
}

function trackObserverCleanup(runtime) {
  const observe = runtime.observe.bind(runtime)
  const stops = []
  const spy = vi.spyOn(runtime, 'observe').mockImplementation((...args) => {
    const observer = observe(...args)
    return {
      getSnapshot: () => observer.getSnapshot(),
      refetch: () => observer.refetch(),
      subscribe(listener) {
        const stop = vi.fn(observer.subscribe(listener))
        stops.push(stop)
        return stop
      },
    }
  })
  return { spy, stops }
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.restoreAllMocks()
})

describe('Solid query accessor', () => {
  it('constructs a side-effect-free observer and starts fetching only after rendering', async () => {
    const read = vi.fn(async () => ({ title: 'Confirmed' }))
    const runtime = runtimeFor({ query: read })
    const query = root(() => {
      const result = useMirrorlessQuery('GetTask', { id: '1' }, { runtime })
      expect(read).not.toHaveBeenCalled()
      expect(result().data).toBeUndefined()
      return result
    })
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
    expect(query().data).toEqual({ title: 'Confirmed' })
    expect(Object.isFrozen(query().data)).toBe(true)
    expect(query()).toBe(query())
  })

  it('requires a Solid owner and an explicit or contextual runtime', () => {
    expect(() => useMirrorlessQuery('GetTasks')).toThrow('Solid component or createRoot')
    expect(() => root(() => useMirrorlessRuntime())).toThrow('MirrorlessProvider')
    expect(() => root(() => useMirrorlessQuery('GetTasks'))).toThrow('query runtime option')
  })

  it('isolates a changed query term immediately, before another request finishes', async () => {
    const second = deferred()
    const read = vi.fn(async (_name, params) => params.id === '1'
      ? { id: '1', title: 'First' }
      : second.promise)
    const runtime = runtimeFor({ query: read })
    const { query, setId } = root(() => {
      const [id, setId] = createSignal('1')
      return {
        setId,
        query: useMirrorlessQuery('GetTask', () => ({ id: id() }), { runtime }),
      }
    })
    await settle()
    expect(query().data.id).toBe('1')
    const refetch = query.refetch
    setId('2')
    expect(query().params).toEqual({ id: '2' })
    expect(query().data).toBeUndefined()
    expect(query.refetch).toBe(refetch)
    await settle()
    second.resolve({ id: '2', title: 'Second' })
    await settle()
    expect(query().data).toEqual({ id: '2', title: 'Second' })
  })

  it('does not churn observers or subscriptions for value-equal parameters', async () => {
    const read = vi.fn(async () => ({ id: '1' }))
    const runtime = runtimeFor({ query: read })
    const { spy, stops } = trackObserverCleanup(runtime)
    const { query, setParams } = root(() => {
      const [params, setParams] = createSignal({ id: '1', filter: { done: false } })
      return { query: useMirrorlessQuery('GetTask', params, { runtime }), setParams }
    })
    await settle()
    setParams({ filter: { done: false }, id: '1' })
    await settle()
    expect(query().data.id).toBe('1')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(stops).toHaveLength(1)
    expect(stops[0]).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('cleans up old terms and the final owner without retaining notifications', async () => {
    const read = vi.fn(async (_name, params) => ({ id: params.id }))
    const runtime = runtimeFor({
      query: read,
      virtualCommands: ['Refresh'],
      updates: { Refresh: ['GetTask'] },
    })
    const { stops } = trackObserverCleanup(runtime)
    const { setId, dispose } = root((dispose) => {
      const [id, setId] = createSignal('1')
      useMirrorlessQuery('GetTask', () => ({ id: id() }), { runtime })
      return { setId, dispose }
    })
    await settle()
    setId('2')
    await settle()
    expect(stops[0]).toHaveBeenCalledTimes(1)
    expect(stops).toHaveLength(2)
    dispose()
    expect(stops[1]).toHaveBeenCalledTimes(1)
    const before = read.mock.calls.length
    await runtime.command('Refresh')
    expect(read).toHaveBeenCalledTimes(before)
  })

  it('shares a core read between independent Solid interests', async () => {
    const read = vi.fn(async () => ({ total: 2 }))
    const runtime = runtimeFor({ query: read })
    const first = root(() => useMirrorlessQuery('GetSummary', {}, { runtime }))
    const second = root(() => useMirrorlessQuery('GetSummary', {}, { runtime }))
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
    expect(first().data).toBe(second().data)
  })

  it('switches explicit runtime identities without exposing the previous identity data', async () => {
    const pending = deferred()
    const first = runtimeFor({ query: async () => ({ user: 'first' }) })
    const second = runtimeFor({ query: async () => pending.promise })
    const { query, setRuntime } = root(() => {
      const [runtime, setRuntime] = createSignal(first)
      return { query: useMirrorlessQuery('CurrentUser', {}, { runtime }), setRuntime }
    })
    await settle()
    expect(query().data.user).toBe('first')
    setRuntime(second)
    expect(query().data).toBeUndefined()
    await settle()
    pending.resolve({ user: 'second' })
    await settle()
    expect(query().data.user).toBe('second')
  })

  it('reactively replaces provider runtimes, hides old session data synchronously, and detaches old notifications', async () => {
    const pending = deferred()
    let firstValue = 'user A'
    const first = runtimeFor({ query: async () => firstValue })
    const second = runtimeFor({ query: async () => pending.promise })
    const { stops } = trackObserverCleanup(first)
    let setRuntime
    let query
    function Consumer() {
      query = useMirrorlessQuery('CurrentUser')
      return () => query().data ?? 'Waiting'
    }
    const { element } = mount(() => {
      const [selected, select] = createSignal(first)
      setRuntime = select
      return createComponent(MirrorlessProvider, {
        get runtime() { return selected() },
        get children() { return createComponent(Consumer, {}) },
      })
    })
    await settle()
    expect(element.textContent).toBe('user A')
    setRuntime(second)
    expect(query().data).toBeUndefined()
    expect(element.textContent).toBe('Waiting')
    expect(stops[0]).toHaveBeenCalledTimes(1)
    expect(first.subscriptionRegistry.subscribers.size).toBe(0)
    expect(second.subscriptionRegistry.subscribers.size).toBe(1)

    // Another owner may still use the previous session runtime. Its subsequent
    // notifications must not reach this provider's now-switched consumer.
    firstValue = 'late user A'
    const oldInterest = first.subscribe('CurrentUser')
    await oldInterest.refetch()
    await settle()
    expect(element.textContent).toBe('Waiting')
    expect(query().data).toBeUndefined()
    pending.resolve('user B')
    await settle()
    expect(element.textContent).toBe('user B')
    oldInterest.unsubscribe()
  })

  it('resolves changing provider runtimes inside a reactive runtime-hook invocation', async () => {
    const first = runtimeFor({ query: async () => 'A' })
    const second = runtimeFor({ query: async () => 'B' })
    let setRuntime
    let current
    function Consumer() {
      current = createMemo(() => useMirrorlessRuntime())
      return null
    }
    mount(() => {
      const [selected, select] = createSignal(first)
      setRuntime = select
      return createComponent(MirrorlessProvider, {
        get runtime() { return selected() },
        get children() { return createComponent(Consumer, {}) },
      })
    })
    expect(current()).toBe(first)
    setRuntime(second)
    expect(current()).toBe(second)
    await settle()
  })

  it('keeps nested providers scoped when an outer runtime changes', async () => {
    const pending = deferred()
    const first = runtimeFor({ query: async () => 'A' })
    const second = runtimeFor({ query: async () => pending.promise })
    const innerRead = vi.fn(async () => 'C')
    const inner = runtimeFor({ query: innerRead })
    const { spy: innerObservers } = trackObserverCleanup(inner)
    let setRuntime
    const { element } = mount(() => {
      const [selected, select] = createSignal(first)
      setRuntime = select
      return createComponent(MirrorlessProvider, {
        get runtime() { return selected() },
        get children() {
          return [
            createComponent(MirrorlessQuery, { id: 'User', loading: 'Outer waiting;', children: (value) => `Outer ${value};` }),
            createComponent(MirrorlessProvider, {
              runtime: inner,
              get children() {
                return createComponent(MirrorlessQuery, { id: 'User', children: (value) => `Inner ${value}` })
              },
            }),
          ]
        },
      })
    })
    await settle()
    expect(element.textContent).toBe('Outer A;Inner C')
    setRuntime(second)
    expect(element.textContent).toBe('Outer waiting;Inner C')
    pending.resolve('B')
    await settle()
    expect(element.textContent).toBe('Outer B;Inner C')
    expect(innerRead).toHaveBeenCalledTimes(1)
    expect(innerObservers).toHaveBeenCalledTimes(1)
  })

  it('supports an interested but initially unfetched read and a stable manual refetch', async () => {
    const read = vi.fn(async () => 'explicit')
    const runtime = runtimeFor({ query: read })
    const query = root(() => useMirrorlessQuery('GetTask', {}, { runtime, fetch: false }))
    await settle()
    expect(read).not.toHaveBeenCalled()
    await query.refetch()
    expect(query().data).toBe('explicit')
  })
})

describe('Solid data boundary', () => {
  it.each([null, false, 0, [], ''])('renders a successful falsy/empty value (%j) as plain data', async (value) => {
    const runtime = runtimeFor({ query: async () => value })
    const renderer = vi.fn((data) => `value:${JSON.stringify(data)}`)
    const { element } = mount(() => provider(runtime, () => createComponent(MirrorlessQuery, {
      id: 'Read',
      loading: 'Waiting',
      children: renderer,
    })))
    expect(element.textContent).toBe('Waiting')
    await settle()
    expect(element.textContent).toBe(`value:${JSON.stringify(value)}`)
    expect(renderer).toHaveBeenCalledWith(value)
  })

  it('handles initial loading and local errors with snapshots', async () => {
    const pending = deferred()
    const runtime = runtimeFor({ query: async () => pending.promise })
    const loading = vi.fn((snapshot) => `Loading ${snapshot.id}`)
    const error = vi.fn((snapshot) => `Error ${snapshot.error.message}`)
    const renderer = vi.fn(() => 'Success')
    const { element } = mount(() => provider(runtime, () => createComponent(MirrorlessQuery, {
      id: 'GetTasks', loading, error, children: renderer,
    })))
    expect(element.textContent).toBe('Loading GetTasks')
    pending.reject(new Error('Unavailable'))
    await settle()
    expect(element.textContent).toBe('Error Unavailable')
    expect(error.mock.calls.at(-1)[0].operationName).toBe('GetTasks')
    expect(renderer).not.toHaveBeenCalled()
  })

  it('throws initial errors into the enclosing Solid ErrorBoundary', async () => {
    const runtime = runtimeFor({ query: async () => { throw new Error('Offline') } })
    const { element } = mount(() => provider(runtime, () => createComponent(ErrorBoundary, {
      fallback: (error) => `Caught ${error.message}`,
      get children() {
        return createComponent(MirrorlessQuery, { id: 'GetTasks', children: () => 'Success' })
      },
    })))
    await settle()
    expect(element.textContent).toBe('Caught Offline')
  })

  it('renders a falsy rejection as an error rather than treating it as loading', async () => {
    const runtime = runtimeFor({ query: async () => { throw null } })
    const { element } = mount(() => provider(runtime, () => createComponent(MirrorlessQuery, {
      id: 'Read', loading: 'Loading', error: () => 'Failed', children: () => 'Success',
    })))
    await settle()
    expect(element.textContent).toBe('Failed')
  })

  it('retains successful content throughout a refresh and a background error', async () => {
    const refreshing = deferred()
    const read = vi.fn().mockResolvedValueOnce({ title: 'Confirmed' }).mockImplementation(() => refreshing.promise)
    const runtime = runtimeFor({ query: read })
    const renderer = vi.fn((data) => data.title)
    const { element } = mount(() => provider(runtime, () => createComponent(MirrorlessQuery, {
      id: 'GetTask', params: { id: '1' },
      loading: 'Loading', error: () => 'Error', children: renderer,
    })))
    await settle()
    expect(element.textContent).toBe('Confirmed')
    expect(renderer).toHaveBeenCalledTimes(1)
    const external = runtime.subscribe('GetTask', { id: '1' })
    const refresh = external.refetch()
    expect(element.textContent).toBe('Confirmed')
    expect(renderer).toHaveBeenCalledTimes(1)
    refreshing.reject(new Error('Background error'))
    await expect(refresh).rejects.toThrow('Background error')
    await settle()
    expect(element.textContent).toBe('Confirmed')
    expect(renderer).toHaveBeenCalledTimes(1)
    external.unsubscribe()
  })

  it('updates a persistent component through reactive data props without remounting it', async () => {
    let version = 0
    let instances = 0
    const runtime = runtimeFor({ query: async () => ({ version: ++version }) })
    function Content(props) {
      instances += 1
      return () => `Version ${props.data.version}`
    }
    const { element } = mount(() => provider(runtime, () => createComponent(MirrorlessQuery, {
      id: 'Read', component: Content,
    })))
    await settle()
    expect(element.textContent).toBe('Version 1')
    expect(instances).toBe(1)
    const external = runtime.subscribe('Read')
    await external.refetch()
    await settle()
    expect(element.textContent).toBe('Version 2')
    expect(instances).toBe(1)
    external.unsubscribe()
  })

  it('hides a persistent result component safely while a new term has no data', async () => {
    const next = deferred()
    const runtime = runtimeFor({ query: async (_id, params) => params.id === '1' ? { title: 'First' } : next.promise })
    let setId
    function Content(props) {
      return () => props.data.title
    }
    const { element } = mount(() => provider(runtime, () => {
      const [id, update] = createSignal('1')
      setId = update
      return createComponent(MirrorlessQuery, {
        id: 'Read', get params() { return { id: id() } },
        loading: 'Waiting', component: Content,
      })
    }))
    await settle()
    expect(element.textContent).toBe('First')
    expect(() => setId('2')).not.toThrow()
    expect(element.textContent).toBe('Waiting')
    next.resolve({ title: 'Second' })
    await settle()
    expect(element.textContent).toBe('Second')
  })

  it('updates independent views after one command through the runtime rules', async () => {
    let title = 'Before'
    const runtime = runtimeFor({
      query: async (name) => name === 'GetTask' ? { title } : { totalCharacters: title.length },
      command: async (_name, params) => { title = params.title; return { ok: true } },
      updates: { Save: ['GetTask', 'GetSummary'] },
    })
    const { element } = mount(() => provider(runtime, () => [
      createComponent(MirrorlessQuery, { id: 'GetTask', children: (task) => `Task:${task.title};` }),
      createComponent(MirrorlessQuery, { id: 'GetSummary', children: (summary) => `Count:${summary.totalCharacters}` }),
    ]))
    await settle()
    expect(element.textContent).toBe('Task:Before;Count:6')
    await runtime.command('Save', { title: 'After' })
    await settle()
    expect(element.textContent).toBe('Task:After;Count:5')
  })

  it('uses reactive component props to isolate a pending new term in the DOM', async () => {
    const next = deferred()
    const runtime = runtimeFor({ query: async (_id, params) => params.id === '1' ? 'First' : next.promise })
    let setId
    const { element } = mount(() => provider(runtime, () => {
      const [id, update] = createSignal('1')
      setId = update
      return createComponent(MirrorlessQuery, {
        id: 'Read', get params() { return { id: id() } },
        loading: 'Waiting', children: (data) => data,
      })
    }))
    await settle()
    expect(element.textContent).toBe('First')
    setId('2')
    expect(element.textContent).toBe('Waiting')
    next.resolve('Second')
    await settle()
    expect(element.textContent).toBe('Second')
  })
})
