// Copyright 2026 Plainweave Systems. SPDX-License-Identifier: Apache-2.0
import type { ReactiveControllerHost } from 'lit'
import { createMirrorless, type QuerySnapshot } from '../../src/core/index.js'
import { bindQuery, type QueryBinding } from '../../src/dom/index.js'
import { MirrorlessController } from '../../src/lit/index.js'

interface Task { id: string; title: string; done: boolean }
declare const host: ReactiveControllerHost
const runtime = createMirrorless({ query: async () => ({ id: '1', title: 'Task', done: false }) })

const binding: QueryBinding<Task> = bindQuery<Task>({
  runtime,
  id: 'GetTask',
  params: { id: '1' },
  render(task) { const title: string = task.title; void title },
  loading(snapshot) { const data: Task | undefined = snapshot.data; void data },
  error(snapshot) { const failure: unknown = snapshot.error; void failure },
})
const snapshot: QuerySnapshot<Task> = binding.snapshot
const data: Task | undefined = binding.data
binding.setQuery('GetTask', { id: '2' })
const refetch: Promise<unknown> = binding.refetch()
binding.dispose()

const controller = new MirrorlessController<Task>(host, { runtime, id: 'GetTask', params: { id: '1' } })
const litSnapshot: QuerySnapshot<Task> = controller.snapshot
const litData: Task | undefined = controller.data
controller.setQuery('GetTask', { id: '2' })
controller.hostConnected()
controller.hostDisconnected()
controller.dispose()

// @ts-expect-error A parameter array is not a named operation parameter object.
binding.setQuery('GetTask', [])
// @ts-expect-error render receives a Task, not an unrelated scalar.
bindQuery<Task>({ runtime, id: 'GetTask', render: (value: string) => { void value } })
// @ts-expect-error Controller data remains optional before the first response.
const unguarded: Task = controller.data

void [snapshot, data, refetch, litSnapshot, litData, unguarded]
