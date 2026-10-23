import type { Accessor, Component, JSX } from 'solid-js'
import type {
  MirrorlessRuntime,
  OperationParams,
  QuerySnapshot,
  SubscriptionOptions,
} from '../core/index.js'

export type MaybeAccessor<T> = T | Accessor<T>

export interface MirrorlessProviderProps {
  runtime: MirrorlessRuntime
  children?: JSX.Element
}

/** Scope a runtime to one Solid owner tree. No global runtime is created. */
export function MirrorlessProvider(props: MirrorlessProviderProps): JSX.Element

/**
 * Resolve the enclosing provider's current runtime, or throw when none exists.
 * Use createMemo(useMirrorlessRuntime) when retaining it across provider changes.
 */
export function useMirrorlessRuntime(): MirrorlessRuntime

export interface MirrorlessQueryOptions extends SubscriptionOptions {
  /** Override context; an accessor also supports changing runtime identities. */
  runtime?: MaybeAccessor<MirrorlessRuntime | undefined>
}

export interface MirrorlessQueryAccessor<T> extends Accessor<QuerySnapshot<T>> {
  /** A stable function targeting this accessor's current query term. */
  refetch(): Promise<unknown>
}

/**
 * Subscribe after rendering; stop notifications with the Solid owner. Pass
 * accessors for reactive names/params. The returned data is not made mutable.
 */
export function useMirrorlessQuery<T = unknown>(
  id: MaybeAccessor<string>,
  params?: MaybeAccessor<OperationParams | undefined>,
  options?: MirrorlessQueryOptions,
): MirrorlessQueryAccessor<T>

export type MirrorlessSnapshotView<T> = JSX.Element | Component<QuerySnapshot<T>>

export interface MirrorlessQueryProps<T = unknown> extends SubscriptionOptions {
  id: string
  params?: OperationParams
  runtime?: MaybeAccessor<MirrorlessRuntime | undefined>
  /**
   * Receives plain successful data, including null/false/0. The callback's
   * subtree is recreated for a new result, but not background status changes.
   */
  children?: (data: T) => JSX.Element
  /** Alternative spelling of children(data). */
  render?: (data: T) => JSX.Element
  /**
   * Render one persistent component with reactive props.data. Prefer this when
   * a result-rendering component also owns local interactive state.
   */
  component?: Component<{ data: T }>
  loading?: MirrorlessSnapshotView<T>
  /** With no prior data, an omitted error view throws to a Solid ErrorBoundary. */
  error?: MirrorlessSnapshotView<T>
  fallback?: JSX.Element
}

export function MirrorlessQuery<T = unknown>(props: MirrorlessQueryProps<T>): JSX.Element
