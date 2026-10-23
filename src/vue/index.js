import {
  defineComponent,
  getCurrentInstance,
  inject,
  onBeforeUnmount,
  onMounted,
  onScopeDispose,
  provide,
  shallowReadonly,
  shallowRef,
  toValue,
  watchEffect,
} from 'vue'
import { cloneFrozenJson, sameParams } from 'mirrorless'

const runtimeKey = Symbol.for('mirrorless.vue.runtime')
const optionKeys = ['fetch', 'unsubscribeDelayMs', 'kind']

function requireRuntime(runtime) {
  if (!runtime || typeof runtime.observe !== 'function') {
    throw new Error(
      'Mirrorless needs a runtime. Call provideMirrorless(runtime) in an ancestor setup, ' +
      'install createMirrorlessPlugin(runtime), or pass { runtime } to useMirrorlessQuery.',
    )
  }
  return runtime
}

/** Provide a runtime for this component's descendants, not a cross-request singleton. */
export function provideMirrorless(runtime) {
  if (!getCurrentInstance()) {
    throw new Error('provideMirrorless() must be called during component setup.')
  }
  provide(runtimeKey, requireRuntime(runtime))
  return runtime
}

/** App-level provider; create a distinct runtime for each app/session or SSR request. */
export function createMirrorlessPlugin(runtime) {
  requireRuntime(runtime)
  return {
    install(app) {
      app.provide(runtimeKey, runtime)
    },
  }
}

export function useMirrorlessRuntime() {
  if (!getCurrentInstance()) {
    throw new Error('useMirrorlessRuntime() must be called during component setup.')
  }
  return requireRuntime(inject(runtimeKey, undefined))
}

/**
 * Deliver a read-only shallow snapshot. Constructing the composable is inert:
 * interest starts on mount, never during SSR or setup/render.
 *
 * name, params, and options accept a value, ref, or getter. The returned `snapshot`
 * is a shallow readonly ref, so server data is not converted into a Vue model.
 */
export function useMirrorlessQuery(name, params = {}, options = {}) {
  if (!getCurrentInstance()) {
    throw new Error('useMirrorlessQuery() must be called during component setup.')
  }

  const inheritedRuntime = inject(runtimeKey, undefined)
  const snapshot = shallowRef()
  let observer
  let currentRuntime
  let currentName
  let currentParams
  let currentOptions
  let stopObserver
  let generation = 0
  let mounted = false
  let disposed = false

  const stop = () => {
    generation += 1
    const cleanup = stopObserver
    stopObserver = undefined
    cleanup?.()
  }

  const activate = () => {
    if (!mounted || disposed || !observer || stopObserver) return
    const activeObserver = observer
    const activeGeneration = generation
    const read = () => {
      if (!disposed && activeGeneration === generation && activeObserver === observer) {
        snapshot.value = activeObserver.getSnapshot()
      }
    }
    const cleanup = activeObserver.subscribe(read)
    if (disposed || !mounted || activeGeneration !== generation || activeObserver !== observer) {
      cleanup()
      return
    }
    stopObserver = cleanup
    // Core may begin fetching before attaching this observer's listener. Reading
    // after subscription closes that race without initiating another request.
    read()
  }

  watchEffect(() => {
    const nextName = toValue(name)
    // Copy while the effect is active: nested reactive parameter reads are
    // tracked, and comparison is against detached values rather than a proxy
    // that can subsequently mutate in place.
    const nextParams = cloneFrozenJson(toValue(params) ?? {})
    const resolvedOptions = toValue(options) ?? {}
    const nextRuntime = requireRuntime(resolvedOptions.runtime ?? inheritedRuntime)
    const nextOptions = Object.fromEntries(
      optionKeys
        .filter((key) => resolvedOptions[key] !== undefined)
        .map((key) => [key, resolvedOptions[key]]),
    )

    if (
      observer &&
      nextRuntime === currentRuntime &&
      nextName === currentName &&
      sameParams(nextParams, currentParams) &&
      optionKeys.every((key) => Object.is(nextOptions[key], currentOptions[key]))
    ) {
      return
    }

    const nextObserver = nextRuntime.observe(nextName, nextParams, nextOptions)
    stop()
    observer = nextObserver
    currentRuntime = nextRuntime
    currentName = nextName
    currentParams = nextParams
    currentOptions = nextOptions
    // Switching terms must drop the previous term's data synchronously, before
    // Vue renders the new props. Existing data for this exact term may be reused.
    snapshot.value = nextObserver.getSnapshot()
    activate()
  }, { flush: 'sync' })

  onMounted(() => {
    mounted = true
    activate()
  })

  const dispose = () => {
    if (disposed) return
    disposed = true
    mounted = false
    stop()
  }
  onBeforeUnmount(dispose)
  onScopeDispose(dispose)

  return Object.freeze({
    snapshot: shallowReadonly(snapshot),
    async refetch() {
      return observer?.refetch()
    },
  })
}

/**
 * A plain-data rendering boundary. `#default` receives { data }; loading and
 * initial-error slots receive the full snapshot. Prior data stays visible
 * during subsequent refreshes and refresh failures.
 */
export const MirrorlessQuery = defineComponent({
  name: 'MirrorlessQuery',
  inheritAttrs: false,
  props: {
    id: { type: String, required: true },
    params: { type: Object, default: () => ({}) },
    runtime: { type: Object, default: undefined },
    fetch: { type: Boolean, default: true },
    unsubscribeDelayMs: { type: Number, default: undefined },
    kind: { type: String, default: undefined },
  },
  setup(props, { slots, expose }) {
    const query = useMirrorlessQuery(
      () => props.id,
      () => props.params,
      () => ({
        runtime: props.runtime,
        fetch: props.fetch,
        unsubscribeDelayMs: props.unsubscribeDelayMs,
        kind: props.kind,
      }),
    )
    expose(query)

    return () => {
      const current = query.snapshot.value
      if (current.data !== undefined) {
        return slots.default?.({ data: current.data }) ?? null
      }
      if (current.status === 'error') {
        if (slots.error) return slots.error(current)
        throw current.error
      }
      return slots.loading?.(current) ?? null
    }
  },
})
