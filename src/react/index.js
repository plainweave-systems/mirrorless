import {
  createContext,
  createElement,
  isValidElement,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import { cloneFrozenJson, sameParams } from '../core/index.js'

/** A context per renderer, never an implicit cross-request runtime. */
export const MirrorlessContext = createContext(undefined)
MirrorlessContext.displayName = 'MirrorlessContext'

export function MirrorlessProvider({ runtime, children }) {
  return createElement(MirrorlessContext.Provider, { value: runtime }, children)
}

export function useMirrorlessRuntime() {
  const runtime = useContext(MirrorlessContext)
  if (!runtime) {
    throw new Error('Mirrorless requires a <MirrorlessProvider runtime={runtime}>.')
  }
  return runtime
}

function useValueParams(params, equal) {
  const previous = useRef(undefined)
  // Compare the same JSON representation the core uses. Optional undefined
  // fields must not make every inline object look like a different read.
  const next = cloneFrozenJson(params ?? {})
  if (previous.current === undefined || !equal(previous.current, next)) {
    previous.current = next
  }
  return previous.current
}

/** Subscribe at commit time; reading/constructing an observer does not fetch. */
export function useMirrorlessQuery(id, params = {}, options = {}) {
  const providedRuntime = useContext(MirrorlessContext)
  const runtime = options.runtime ?? providedRuntime
  if (!runtime) {
    throw new Error('Mirrorless requires a provider or an explicit options.runtime.')
  }

  const stableParams = useValueParams(params, runtime.equal ?? sameParams)
  const { fetch, unsubscribeDelayMs, kind } = options
  const source = useMemo(() => {
    const observer = runtime.observe(id, stableParams, { fetch, unsubscribeDelayMs, kind })
    return {
      subscribe: (listener) => observer.subscribe(listener),
      getSnapshot: () => observer.getSnapshot(),
      refetch: () => observer.refetch(),
    }
  }, [runtime, id, stableParams, fetch, unsubscribeDelayMs, kind])

  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  return useMemo(() => Object.freeze({ ...snapshot, refetch: source.refetch }), [snapshot, source])
}

function renderBoundary(component, snapshot) {
  if (component == null) return null
  if (isValidElement(component)) return component
  // A boundary is a real React component, including memo/forwardRef components.
  // Calling it as a function would attach its hooks to MirrorlessQuery itself.
  return createElement(component, snapshot)
}

export function MirrorlessQuery({
  id,
  params = {},
  children,
  render,
  loading = MirrorlessLoadingNone,
  error,
  fallback = null,
  ...options
}) {
  const query = useMirrorlessQuery(id, params, options)

  if (query.data === undefined) {
    if (query.status === 'error') {
      if (error != null) return renderBoundary(error, query)
      throw query.error
    }
    return renderBoundary(loading, query)
  }

  const renderer = children ?? render
  return typeof renderer === 'function' ? renderer(query.data) : fallback
}

export function MirrorlessLoadingNone() {
  return null
}

/** Optional web-only indicator. Supply a native component in React Native. */
export function MirrorlessLoadingSpinner({ label = 'Loading', style, ...props } = {}) {
  return createElement(
    'span',
    {
      role: 'status',
      'aria-live': 'polite',
      ...props,
      style: { display: 'inline-flex', alignItems: 'center', gap: '0.5em', ...style },
    },
    createElement(
      'svg',
      { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
      createElement('circle', { cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 3, opacity: 0.25 }),
      createElement('path', { d: 'M12 3a9 9 0 0 1 9 9', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' }),
    ),
    label,
  )
}
