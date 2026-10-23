import { createContext, createElement, isValidElement } from 'preact'
import { useContext, useMemo, useRef } from 'preact/hooks'
import { useSyncExternalStore } from 'preact/compat'
import { cloneFrozenJson, sameParams } from '../core/index.js'

/** Preact's own context: the React adapter is not imported or required. */
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
  const next = cloneFrozenJson(params ?? {})
  if (previous.current === undefined || !equal(previous.current, next)) {
    previous.current = next
  }
  return previous.current
}

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

/** Static, reduced-motion-safe indicator with no app stylesheet dependency. */
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
