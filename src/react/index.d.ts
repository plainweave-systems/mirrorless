import type {
  ComponentType,
  Context,
  HTMLAttributes,
  ReactElement,
  ReactNode,
} from 'react'
import type {
  MirrorlessObserver,
  MirrorlessRuntime,
  OperationParams,
  QuerySnapshot,
  SubscriptionOptions,
} from '../core/index.js'

export interface MirrorlessProviderProps {
  runtime: MirrorlessRuntime
  children?: ReactNode
}

export interface MirrorlessQueryOptions extends SubscriptionOptions {
  /** Overrides context, useful for isolated components and tests. */
  runtime?: MirrorlessRuntime
}

export type MirrorlessQueryResult<T = unknown> = QuerySnapshot<T> & {
  readonly refetch: MirrorlessObserver<T>['refetch']
}

export type MirrorlessBoundary<T = unknown> =
  | ComponentType<MirrorlessQueryResult<T>>
  | ReactElement
  | null

export interface MirrorlessQueryProps<T = unknown> extends MirrorlessQueryOptions {
  id: string
  params?: OperationParams
  /** Called with data only, and only once a defined value is available. */
  children?: (data: T) => ReactNode
  /** Alternative to the function child. */
  render?: (data: T) => ReactNode
  loading?: MirrorlessBoundary<T>
  /** Without a local error component, initial failures reach an error boundary. */
  error?: MirrorlessBoundary<T>
  fallback?: ReactNode
}

export declare const MirrorlessContext: Context<MirrorlessRuntime | undefined>
export declare function MirrorlessProvider(props: MirrorlessProviderProps): ReactElement
export declare function useMirrorlessRuntime(): MirrorlessRuntime
export declare function useMirrorlessQuery<T = unknown>(
  id: string,
  params?: OperationParams,
  options?: MirrorlessQueryOptions,
): MirrorlessQueryResult<T>
export declare function MirrorlessQuery<T = unknown>(props: MirrorlessQueryProps<T>): ReactNode
export declare function MirrorlessLoadingNone(): null

export interface MirrorlessLoadingSpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  label?: string
}
/** Web-only loading indicator; use native components with React Native. */
export declare function MirrorlessLoadingSpinner(props?: MirrorlessLoadingSpinnerProps): ReactElement
