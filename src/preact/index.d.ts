import type {
  ComponentChildren,
  ComponentType,
  Context,
  JSX,
  VNode,
} from 'preact'
import type {
  MirrorlessObserver,
  MirrorlessRuntime,
  OperationParams,
  QuerySnapshot,
  SubscriptionOptions,
} from '../core/index.js'

export interface MirrorlessProviderProps {
  runtime: MirrorlessRuntime
  children?: ComponentChildren
}

export interface MirrorlessQueryOptions extends SubscriptionOptions {
  runtime?: MirrorlessRuntime
}

export type MirrorlessQueryResult<T = unknown> = QuerySnapshot<T> & {
  readonly refetch: MirrorlessObserver<T>['refetch']
}

export type MirrorlessBoundary<T = unknown> =
  | ComponentType<MirrorlessQueryResult<T>>
  | VNode
  | null

export interface MirrorlessQueryProps<T = unknown> extends MirrorlessQueryOptions {
  id: string
  params?: OperationParams
  children?: (data: T) => ComponentChildren
  render?: (data: T) => ComponentChildren
  loading?: MirrorlessBoundary<T>
  error?: MirrorlessBoundary<T>
  fallback?: ComponentChildren
}

export declare const MirrorlessContext: Context<MirrorlessRuntime | undefined>
export declare function MirrorlessProvider(props: MirrorlessProviderProps): VNode
export declare function useMirrorlessRuntime(): MirrorlessRuntime
export declare function useMirrorlessQuery<T = unknown>(
  id: string,
  params?: OperationParams,
  options?: MirrorlessQueryOptions,
): MirrorlessQueryResult<T>
export declare function MirrorlessQuery<T = unknown>(props: MirrorlessQueryProps<T>): ComponentChildren
export declare function MirrorlessLoadingNone(): null

export interface MirrorlessLoadingSpinnerProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  label?: string
}
export declare function MirrorlessLoadingSpinner(props?: MirrorlessLoadingSpinnerProps): VNode
