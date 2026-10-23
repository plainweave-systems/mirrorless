// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import type { MirrorlessSubscription, OperationParams } from 'mirrorless'
import { createTaskRuntime, startLiveRefresh } from '../shared/task-api.js'
import type { Task, TaskSummary } from '../shared/task-api.js'

// Ordinary plain-data consumers: no runtime, snapshot, or client-owned entity store.
function printTasks(tasks: readonly Task[]): void {
  console.log('Tasks:', JSON.stringify(tasks))
}
function printSummary(summary: TaskSummary): void {
  console.log('Summary:', JSON.stringify(summary))
}
function printTask(task: Task): void {
  console.log('Selected task:', JSON.stringify(task))
}

function flags(args: string[]) {
  let title: string | undefined
  let live = false
  let completeCreated = false
  let selectedId: string | undefined
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--add':
        title = args[++i]
        if (!title || title.startsWith('--')) throw new Error('--add requires a title')
        break
      case '--select':
        selectedId = args[++i]
        if (!selectedId || selectedId.startsWith('--')) throw new Error('--select requires an id')
        break
      case '--live': live = true; break
      case '--complete-created': completeCreated = true; break
      default: throw new Error(`Unknown flag: ${args[i]}`)
    }
  }
  if (completeCreated && title === undefined) throw new Error('--complete-created requires --add')
  return { title, live, completeCreated, selectedId }
}

async function main(): Promise<void> {
  // These flags and interaction fields are local CLI state, never server data.
  const options = flags(process.argv.slice(2))
  let pending = false
  let commandError: unknown
  const baseUrl = process.env.TASK_API_URL ?? 'http://127.0.0.1:4000/api'
  const url = new URL(baseUrl)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('TASK_API_URL must be a credential-free loopback HTTP URL')
  }
  const runtime = createTaskRuntime({ baseUrl, unsubscribeDelayMs: 0 })
  const cleanups: (() => void)[] = []
  let stopLive = () => {}

  function watch<T>(name: string, consume: (data: T) => void, params: OperationParams = {}): MirrorlessSubscription<T> {
    const subscription = runtime.subscribe<T>(name, params, { fetch: false })
    cleanups.push(() => subscription.unsubscribe())
    const render = () => {
      const snapshot = subscription.getSnapshot()
      if (snapshot.loading) console.log(`${name}: loading`)
      if (snapshot.status === 'error') console.error(`${name}:`, snapshot.error)
      // undefined alone means no successful value; []/null/false/0 are data.
      if (snapshot.data !== undefined) consume(snapshot.data)
    }
    subscription.onChange(render)
    render()
    return subscription
  }

  try {
    const tasks = watch<readonly Task[]>('GetTasks', printTasks)
    const summary = watch<TaskSummary>('GetSummary', printSummary) // independent interest
    await Promise.all([tasks.refetch(), summary.refetch()])
    if (options.selectedId !== undefined) {
      await watch<Task>('GetTask', printTask, { id: options.selectedId }).refetch()
    }

    if (options.title !== undefined) {
      pending = true
      commandError = undefined
      console.log('Command pending:', pending)
      try {
        // POST returns only {id}; updates rules refetch both subscribed reads.
        // Never append to tasks or increment summary locally.
        const receipt = await runtime.command<{ id: string }>('CreateTask', { title: options.title })
        console.log('CreateTask receipt:', JSON.stringify(receipt))
        if (options.completeCreated) {
          const selected: OperationParams = { id: receipt.id }
          const detail = watch<Task>('GetTask', printTask, selected)
          await detail.refetch()
          // Shared helper: UpdateTask -> ['GetTask', {id: Symbol.for('id')}].
          // The command's id binds by VALUE to this detail's params, not object identity.
          const updated = await runtime.command<{ ok: true }>('UpdateTask', { id: receipt.id, done: true })
          console.log('UpdateTask receipt:', JSON.stringify(updated))
        }
      } catch (error) {
        commandError = error
        throw commandError
      } finally {
        pending = false
        console.log('Command pending:', pending)
      }
    }
    if (options.live) {
      stopLive = startLiveRefresh(runtime, 2000, { onError: (error) => console.error('RefreshTasks:', error) })
      console.log('Live: RefreshTasks every 2000ms; Ctrl-C to stop')
      // A referenced wait keeps this headless process alive (the shared timer is unref'ed).
      await new Promise<void>((resolve) => {
        const keepAlive = setInterval(() => {}, 60_000)
        const stop = () => resolve()
        process.once('SIGINT', stop)
        process.once('SIGTERM', stop)
        cleanups.push(() => {
          clearInterval(keepAlive)
          process.off('SIGINT', stop)
          process.off('SIGTERM', stop)
        })
      })
    }
  } finally {
    stopLive()
    for (const cleanup of cleanups.reverse()) cleanup()
    runtime.dispose()
  }
}

// No emitted JS, ts-node, bundler, or TypeScript runtime syntax is needed.
await main().catch((error: unknown) => {
  console.error('Example failed:', error)
  process.exitCode = 1
})
