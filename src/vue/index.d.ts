import type {
  App,
  ComponentPublicInstance,
  DefineComponent,
  MaybeRefOrGetter,
  Plugin,
  ShallowRef,
  VNodeChild,
} from 'vue'
import type {
  MirrorlessRuntime,
  OperationParams,
  QuerySnapshot,
  SubscriptionOptions,
} from 'mirrorless'

export interface VueQueryOptions extends SubscriptionOptions {
  /** Overrides the nearest component/app provider. */
  runtime?: MirrorlessRuntime
}

export interface MirrorlessQueryResource<T = unknown> {
  /** Read-only shallow delivery ref; returned data is not a deep Vue model. */
  readonly snapshot: Readonly<ShallowRef<QuerySnapshot<T>>>
  /** Refetches existing interested work; does not create interest before mount. */
  readonly refetch: () => Promise<unknown>
}

/** Call inside setup to provide a runtime to descendants. Does not dispose it. */
export declare function provideMirrorless(runtime: MirrorlessRuntime): MirrorlessRuntime

/** Install on each app separately. Does not create a global/shared runtime. */
export declare function createMirrorlessPlugin(runtime: MirrorlessRuntime): Plugin & {
  install(app: App): void
}

/** Reads the closest provider. Throws when called outside setup or without one. */
export declare function useMirrorlessRuntime(): MirrorlessRuntime

/**
 * Component-scoped interest, activated only on mount. Reactive names, parameter
 * objects/getters, and options are compared before resubscription. A new term
 * never exposes the previous term's data. Unmount stops notifications at once;
 * core decides how long the underlying interest lease remains.
 */
export declare function useMirrorlessQuery<T = unknown>(
  name: MaybeRefOrGetter<string>,
  params?: MaybeRefOrGetter<OperationParams>,
  options?: MaybeRefOrGetter<VueQueryOptions>,
): MirrorlessQueryResource<T>

export interface MirrorlessQueryProps {
  id: string
  params?: OperationParams
  runtime?: MirrorlessRuntime
  fetch?: boolean
  unsubscribeDelayMs?: number
  kind?: string
}

export interface MirrorlessQuerySlots<T = unknown> {
  /** Called only once data is defined. Null, false, 0, and [] are valid data. */
  default?: (scope: { data: T }) => VNodeChild
  /** Initial idle/loading/undefined-data rendering. */
  loading?: (snapshot: QuerySnapshot<T>) => VNodeChild
  /** Initial errors only. Without this slot the error is thrown during render. */
  error?: (snapshot: QuerySnapshot<T>) => VNodeChild
}

/**
 * Default slot receives only { data }; loading/error slots receive snapshots.
 * Prior data stays rendered during refresh/error. For typed SFC slots, specialize
 * the constructor in script: `const TaskQuery = MirrorlessQuery<Task[]>`.
 */
export declare const MirrorlessQuery: DefineComponent<MirrorlessQueryProps> & {
  new <T = unknown>(): ComponentPublicInstance<MirrorlessQueryProps, MirrorlessQueryResource<T>> & {
    $slots: MirrorlessQuerySlots<T>
  }
}
