import type { MirrorlessRuntime } from 'mirrorless'

export interface Task { id: string; title: string; done: boolean }
export interface TaskSummary { total: number; done: number }
export interface TaskRuntimeOptions {
  baseUrl?: string
  fetch?: typeof globalThis.fetch
  unsubscribeDelayMs?: number
}
export function createTaskRuntime(options?: TaskRuntimeOptions): MirrorlessRuntime
export function startLiveRefresh(runtime: MirrorlessRuntime, intervalMs?: number, options?: { onError?: (error: unknown) => void }): () => void
