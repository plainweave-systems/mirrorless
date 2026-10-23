import {
  createComponent,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  getOwner,
  onCleanup,
  Show,
  useContext,
} from 'solid-js'
import { cloneFrozenJson, sameParams } from '../core/index.js'

const MirrorlessContext = createContext()

function read(value) {
  return typeof value === 'function' ? value() : value
}

function sameSource(previous, next) {
  return previous?.runtime === next.runtime &&
    previous.id === next.id &&
    sameParams(previous.params, next.params) &&
    previous.fetch === next.fetch &&
    previous.unsubscribeDelayMs === next.unsubscribeDelayMs &&
    previous.kind === next.kind
}

function renderView(view, snapshot) {
  return typeof view === 'function' ? createComponent(view, snapshot) : view ?? null
}

/** Provide one runtime for this Solid owner tree, not a process-wide singleton. */
export function MirrorlessProvider(props) {
  return createComponent(MirrorlessContext.Provider, {
    // Solid context values are captured by consumers. Keep the scoped value
    // stable, but defer reading the potentially reactive provider runtime.
    value: () => props.runtime,
    get children() { return props.children },
  })
}

export function useMirrorlessRuntime() {
  const getRuntime = useContext(MirrorlessContext)
  const runtime = getRuntime?.()
  if (!runtime) {
    throw new Error('Mirrorless: useMirrorlessRuntime requires a MirrorlessProvider.')
  }
  return runtime
}

/**
 * Read one term through a Solid accessor. Observer construction is pure; the
 * effect starts interest after rendering and releases it with the Solid owner.
 */
export function useMirrorlessQuery(id, params = {}, options = {}) {
  if (!getOwner()) {
    throw new Error('Mirrorless: useMirrorlessQuery must run inside a Solid component or createRoot.')
  }

  const getContextRuntime = useContext(MirrorlessContext)
  const source = createMemo(() => {
    const runtime = read(options.runtime) ?? getContextRuntime?.()
    if (!runtime) {
      throw new Error('Mirrorless: provide a MirrorlessProvider or a query runtime option.')
    }
    return {
      runtime,
      id: read(id),
      // Preserve the previous term even if a reactive params object is mutated.
      params: cloneFrozenJson(read(params) ?? {}),
      fetch: options.fetch,
      unsubscribeDelayMs: options.unsubscribeDelayMs,
      kind: options.kind,
    }
  }, undefined, { equals: sameSource })

  const observer = createMemo(() => {
    const current = source()
    return current.runtime.observe(current.id, current.params, {
      fetch: current.fetch,
      unsubscribeDelayMs: current.unsubscribeDelayMs,
      kind: current.kind ?? 'component',
    })
  })
  const [revision, setRevision] = createSignal(0)

  createEffect(() => {
    const current = observer()
    const stop = current.subscribe(() => setRevision((value) => value + 1))
    // subscribe may synchronously advance idle -> loading before listening.
    setRevision((value) => value + 1)
    onCleanup(stop)
  })

  const snapshot = () => {
    revision()
    // Reading the current observer here synchronously isolates a new term from
    // the old result, even before the subscription effect has been rescheduled.
    return observer().getSnapshot()
  }
  snapshot.refetch = () => observer().refetch()
  return snapshot
}

/**
 * Render plain confirmed data. `component` supplies reactive data props while
 * retaining one Solid component instance; children(data) is a keyed-by-result
 * render callback. Neither success form reruns for background status alone.
 */
export function MirrorlessQuery(props) {
  const query = useMirrorlessQuery(() => props.id, () => props.params ?? {}, {
    get runtime() { return props.runtime },
    get fetch() { return props.fetch },
    get unsubscribeDelayMs() { return props.unsubscribeDelayMs },
    get kind() { return props.kind },
  })
  const data = createMemo(() => query().data)
  const waiting = createMemo(() => {
    const snapshot = query()
    if (snapshot.data !== undefined) return null
    if (snapshot.status === 'error') {
      if (props.error !== undefined) return renderView(props.error, snapshot)
      throw snapshot.error
    }
    return renderView(props.loading, snapshot)
  })

  return createComponent(Show, {
    get when() { return data() !== undefined },
    get fallback() { return waiting() },
    children: (_available) => {
      if (props.component) {
        return createComponent(props.component, {
          get data() { return data() },
        })
      }
      return createMemo(() => {
        const value = data()
        if (value === undefined) return null
        const renderer = props.children ?? props.render
        return typeof renderer === 'function' ? renderer(value) : props.fallback ?? null
      })
    },
  })
}
