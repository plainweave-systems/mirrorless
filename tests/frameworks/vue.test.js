// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createApp,
  createSSRApp,
  defineComponent,
  h,
  isReactive,
  isReadonly,
  nextTick,
  onBeforeMount,
  onErrorCaptured,
  reactive,
  ref,
  shallowRef,
} from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createMirrorless } from 'mirrorless'
import {
  createMirrorlessPlugin,
  MirrorlessQuery,
  provideMirrorless,
  useMirrorlessQuery,
  useMirrorlessRuntime,
} from 'mirrorless/vue'

const mountedApps = []
const runtimes = []

function runtime(options = {}) {
  const value = createMirrorless({ unsubscribeDelayMs: 0, ...options })
  runtimes.push(value)
  return value
}

function mount(component, providedRuntime) {
  const element = document.createElement('div')
  document.body.append(element)
  const app = createApp(component)
  if (providedRuntime) app.use(createMirrorlessPlugin(providedRuntime))
  mountedApps.push({ app, element })
  app.mount(element)
  return { app, element, unmount: () => app.unmount() }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function boundary(props = {}, slots = {}) {
  return defineComponent({
    setup() {
      return () => h(MirrorlessQuery, { id: 'Read', ...props }, {
        default: ({ data }) => h('p', { 'data-value': '' }, JSON.stringify(data)),
        loading: () => h('p', { 'data-loading': '' }, 'Loading'),
        ...slots,
      })
    },
  })
}

afterEach(() => {
  for (const { app, element } of mountedApps.splice(0)) {
    if (app._container) app.unmount()
    element.remove()
  }
  for (const value of runtimes.splice(0)) value.dispose()
  vi.restoreAllMocks()
})

describe('Vue Mirrorless delivery', () => {
  it('activates only on mount and delivers shallow read-only snapshots', async () => {
    const result = { title: 'From the server', nested: { done: false } }
    const query = vi.fn(async () => result)
    const value = runtime({ query })
    let resource
    let requestsBeforeMount
    const Host = defineComponent({
      setup() {
        resource = useMirrorlessQuery('Read')
        expect(query).not.toHaveBeenCalled()
        onBeforeMount(() => { requestsBeforeMount = query.mock.calls.length })
        return () => h('p', resource.snapshot.value.data?.title ?? 'Loading')
      },
    })
    const { element } = mount(Host, value)
    expect(requestsBeforeMount).toBe(0)
    await flush()
    expect(query).toHaveBeenCalledTimes(1)
    expect(element.textContent).toBe('From the server')
    expect(isReadonly(resource.snapshot)).toBe(true)
    expect(isReactive(resource.snapshot.value.data)).toBe(false)
    expect(isReactive(resource.snapshot.value.data.nested)).toBe(false)
    expect(Object.isFrozen(resource.snapshot.value.data)).toBe(true)
  })

  it('does not fetch during SSR and has no shared default runtime', async () => {
    const firstQuery = vi.fn(async () => 'one')
    const secondQuery = vi.fn(async () => 'two')
    for (const value of [runtime({ query: firstQuery }), runtime({ query: secondQuery })]) {
      const app = createSSRApp(boundary())
      app.use(createMirrorlessPlugin(value))
      expect(await renderToString(app)).toContain('Loading')
    }
    expect(firstQuery).not.toHaveBeenCalled()
    expect(secondQuery).not.toHaveBeenCalled()
  })

  it('supports an explicit runtime without an injected provider', async () => {
    const value = runtime({ query: async () => 'explicit' })
    const { element } = mount(boundary({ runtime: value }))
    await flush()
    expect(element.textContent).toBe('"explicit"')
  })

  it('scopes providers to descendants and allows a nested override', async () => {
    const outer = runtime({ query: async () => 'outer' })
    const inner = runtime({ query: async () => 'inner' })
    const Child = defineComponent({
      setup() {
        const { snapshot } = useMirrorlessQuery('Read')
        return () => h('span', snapshot.value.data ?? 'Loading')
      },
    })
    const NestedProvider = defineComponent({
      setup() {
        expect(provideMirrorless(inner)).toBe(inner)
        return () => h(Child)
      },
    })
    const Host = defineComponent({
      setup() {
        expect(useMirrorlessRuntime()).toBe(outer)
        return () => h('div', [h(Child), h(NestedProvider)])
      },
    })
    const { element } = mount(Host, outer)
    await flush()
    expect(element.textContent).toBe('outerinner')
  })

  it('requires a component lifecycle for its composables', () => {
    const value = runtime({ query: async () => null })
    expect(() => provideMirrorless(value)).toThrow(/setup/)
    expect(() => useMirrorlessRuntime()).toThrow(/setup/)
    expect(() => useMirrorlessQuery('Read', {}, { runtime: value })).toThrow(/setup/)
  })

  it('reports a missing provider instead of using a singleton', () => {
    const errors = []
    const app = createApp({ setup: () => useMirrorlessQuery('Read') })
    const element = document.createElement('div')
    app.config.errorHandler = (error) => errors.push(error)
    mountedApps.push({ app, element })
    app.mount(element)
    expect(errors[0]?.message).toMatch(/needs a runtime/)
  })

  it('passes only plain data to the success slot after a first value exists', async () => {
    const pending = deferred()
    const value = runtime({ query: () => pending.promise })
    const success = vi.fn(({ data }) => h('p', data.title))
    const loading = vi.fn((snapshot) => h('p', snapshot.loading ? 'Fetching' : 'Idle'))
    const { element } = mount(boundary({}, { default: success, loading }), value)
    expect(success).not.toHaveBeenCalled()
    expect(loading.mock.calls[0][0].data).toBeUndefined()
    pending.resolve({ title: 'Ready' })
    await flush()
    expect(element.textContent).toBe('Ready')
    expect(Object.keys(success.mock.calls.at(-1)[0])).toEqual(['data'])
  })

  it.each([null, false, 0, '', []])('treats %j as valid defined data', async (data) => {
    const value = runtime({ query: async () => data })
    const success = vi.fn(({ data: received }) => h('p', JSON.stringify(received)))
    const { element } = mount(boundary({}, { default: success }), value)
    await flush()
    expect(success).toHaveBeenCalled()
    expect(success.mock.calls.at(-1)[0].data).toEqual(data)
    expect(element.querySelector('[data-loading]')).toBeNull()
  })

  it('keeps the loading boundary for an undefined result', async () => {
    const value = runtime({ query: async () => undefined })
    const success = vi.fn(() => h('p', 'Unexpected'))
    const { element } = mount(boundary({}, { default: success }), value)
    await flush()
    expect(success).not.toHaveBeenCalled()
    expect(element.textContent).toBe('Loading')
  })

  it('delivers initial failures through the local error slot', async () => {
    const failure = new Error('Read failed')
    const value = runtime({ query: async () => { throw failure } })
    const error = vi.fn((snapshot) => h('p', snapshot.error.message))
    const { element } = mount(boundary({}, { error }), value)
    await flush()
    expect(element.textContent).toBe('Read failed')
    expect(error.mock.calls.at(-1)[0].error).toBe(failure)
    expect(error.mock.calls.at(-1)[0].data).toBeUndefined()
  })

  it('throws initial failures to a Vue error boundary when no local slot exists', async () => {
    const failure = new Error('Boundary failure')
    const value = runtime({ query: async () => { throw failure } })
    const captured = []
    const Host = defineComponent({
      setup() {
        const error = shallowRef()
        onErrorCaptured((cause) => {
          captured.push(cause)
          error.value = cause
          return false
        })
        return () => error.value
          ? h('p', error.value.message)
          : h(MirrorlessQuery, { id: 'Read' }, { default: () => h('p', 'Unexpected') })
      },
    })
    const { element } = mount(Host, value)
    await flush()
    expect(captured).toEqual([failure])
    expect(element.textContent).toBe('Boundary failure')
  })

  it('retains previous data through refresh and refresh errors', async () => {
    const pending = deferred()
    const query = vi.fn()
      .mockResolvedValueOnce({ title: 'Confirmed' })
      .mockImplementationOnce(() => pending.promise)
      .mockRejectedValueOnce(new Error('Background failure'))
    const value = runtime({ query })
    const queryComponent = ref()
    const localError = vi.fn(() => h('p', 'Unexpected error view'))
    const Host = defineComponent({
      setup() {
        return () => h(MirrorlessQuery, { id: 'Read', ref: queryComponent }, {
          default: ({ data }) => h('p', data.title),
          loading: () => h('p', 'Loading'),
          error: localError,
        })
      },
    })
    const { element } = mount(Host, value)
    await flush()
    expect(element.textContent).toBe('Confirmed')
    const refreshing = queryComponent.value.refetch()
    await flush()
    expect(element.textContent).toBe('Confirmed')
    pending.resolve({ title: 'Updated' })
    await refreshing
    await flush()
    expect(element.textContent).toBe('Updated')
    await expect(queryComponent.value.refetch()).rejects.toThrow('Background failure')
    await flush()
    expect(element.textContent).toBe('Updated')
    expect(localError).not.toHaveBeenCalled()
  })

  it('switches reactive names and nested parameters without exposing another term', async () => {
    const name = ref('Read')
    const params = reactive({ id: 'a', filter: { state: 'all' } })
    const waits = new Map()
    const query = vi.fn((operation, variables) => {
      const pending = deferred()
      waits.set(`${operation}:${variables.id}:${variables.filter.state}`, pending)
      return pending.promise
    })
    const value = runtime({ query })
    let resource
    mount(defineComponent({
      setup() {
        resource = useMirrorlessQuery(name, params)
        return () => h('p', JSON.stringify(resource.snapshot.value.data ?? 'Loading'))
      },
    }), value)
    await flush()
    waits.get('Read:a:all').resolve({ title: 'A' })
    await flush()
    expect(resource.snapshot.value.data.title).toBe('A')

    params.id = 'b'
    expect(resource.snapshot.value.params.id).toBe('b')
    expect(resource.snapshot.value.data).toBeUndefined()
    await flush()
    waits.get('Read:b:all').resolve({ title: 'B' })
    await flush()
    expect(resource.snapshot.value.data.title).toBe('B')

    params.filter.state = 'done'
    expect(resource.snapshot.value.params.filter.state).toBe('done')
    expect(resource.snapshot.value.data).toBeUndefined()
    await flush()
    waits.get('Read:b:done').resolve({ title: 'B done' })
    await flush()
    name.value = 'OtherRead'
    expect(resource.snapshot.value.id).toBe('OtherRead')
    expect(resource.snapshot.value.data).toBeUndefined()
    await flush()
    waits.get('OtherRead:b:done').resolve({ title: 'Other B' })
    await flush()
    expect(resource.snapshot.value.data.title).toBe('Other B')
  })

  it('ignores an old term completion after reactive parameters change', async () => {
    const id = ref('old')
    const old = deferred()
    const next = deferred()
    const value = runtime({ query: (_name, params) => params.id === 'old' ? old.promise : next.promise })
    let resource
    mount(defineComponent({
      setup() {
        resource = useMirrorlessQuery('Read', () => ({ id: id.value }))
        return () => h('p', resource.snapshot.value.data ?? 'Loading')
      },
    }), value)
    await flush()
    id.value = 'new'
    expect(resource.snapshot.value.data).toBeUndefined()
    next.resolve('New data')
    await flush()
    old.resolve('Old data')
    await flush()
    expect(resource.snapshot.value.data).toBe('New data')
  })

  it('does not reconstruct an observer for value-equal inline parameters', async () => {
    const params = ref({ id: '1', scope: { done: false } })
    const query = vi.fn(async () => 'Ready')
    const value = runtime({ query })
    const observe = vi.spyOn(value, 'observe')
    let resource
    mount(defineComponent({
      setup() {
        resource = useMirrorlessQuery('Read', () => ({ ...params.value }))
        return () => h('p', resource.snapshot.value.data ?? 'Loading')
      },
    }), value)
    await flush()
    const previous = resource.snapshot.value
    params.value = { scope: { done: false }, id: '1' }
    await flush()
    expect(observe).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledTimes(1)
    expect(resource.snapshot.value).toBe(previous)
  })

  it('reactively switches an explicit runtime without retaining old-session data', async () => {
    const first = runtime({ query: async () => 'First' })
    const second = runtime({ query: async () => 'Second' })
    const activeRuntime = shallowRef(first)
    let resource
    mount(defineComponent({
      setup() {
        resource = useMirrorlessQuery('Read', {}, () => ({ runtime: activeRuntime.value }))
        return () => h('p', resource.snapshot.value.data ?? 'Loading')
      },
    }))
    await flush()
    expect(resource.snapshot.value.data).toBe('First')
    activeRuntime.value = second
    expect(resource.snapshot.value.data).toBeUndefined()
    await flush()
    expect(resource.snapshot.value.data).toBe('Second')
  })

  it('shares one fetch between sibling interests in the same term', async () => {
    const query = vi.fn(async () => 'Shared')
    const value = runtime({ query })
    const showFirst = ref(true)
    const Host = defineComponent({
      setup() {
        return () => h('section', [
          showFirst.value ? h(MirrorlessQuery, { id: 'Read', params: { id: '1' } }, {
            default: ({ data }) => h('p', data),
          }) : null,
          h(MirrorlessQuery, { id: 'Read', params: { id: '1' } }, {
            default: ({ data }) => h('p', data),
          }),
        ])
      },
    })
    const { element } = mount(Host, value)
    await flush()
    expect(query).toHaveBeenCalledTimes(1)
    expect(element.textContent).toBe('SharedShared')
    showFirst.value = false
    await flush()
    expect(element.textContent).toBe('Shared')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('stops Vue notifications immediately even when core retains interest', async () => {
    let revision = 0
    const value = runtime({ unsubscribeDelayMs: 60_000, query: async () => ++revision })
    let resource
    const { unmount } = mount(defineComponent({
      setup() {
        resource = useMirrorlessQuery('Read')
        return () => h('p', resource.snapshot.value.data)
      },
    }), value)
    await flush()
    const before = resource.snapshot.value
    unmount()
    const other = value.subscribe('Read')
    await other.refetch()
    await flush()
    expect(other.getSnapshot().data).toBe(2)
    expect(resource.snapshot.value).toBe(before)
    other.unsubscribe()
  })

  it('allows fetch:false followed by an explicit refetch after mount', async () => {
    const query = vi.fn(async () => 'Manual')
    const value = runtime({ query })
    let resource
    const { element } = mount(defineComponent({
      setup() {
        resource = useMirrorlessQuery('Read', {}, { fetch: false })
        return () => h('p', resource.snapshot.value.data ?? 'Idle')
      },
    }), value)
    await flush()
    expect(query).not.toHaveBeenCalled()
    await resource.refetch()
    await flush()
    expect(query).toHaveBeenCalledTimes(1)
    expect(element.textContent).toBe('Manual')
  })
})
