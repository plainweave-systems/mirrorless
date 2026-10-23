// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
// Compile-only checks of the package's actual public subpaths and generic data contracts.
import { createElement } from 'react'
import type { ReactiveControllerHost } from 'lit'
import {
  createMirrorless, MirrorlessRuntime, MirrorlessCell, cloneFrozenJson,
  type QuerySnapshot, type OperationParams, type MirrorlessObserver,
} from 'mirrorless'
import {
  MirrorlessQuery as ReactQuery, useMirrorlessQuery as useReactQuery,
  type MirrorlessQueryProps as ReactQueryProps,
} from 'mirrorless/react'
import { useMirrorlessQuery as usePreactQuery } from 'mirrorless/preact'
import { useMirrorlessQuery as useVueQuery, MirrorlessQuery as VueQuery } from 'mirrorless/vue'
import { createMirrorlessQuery as createSvelteQuery, MirrorlessQuery as SvelteQuery } from 'mirrorless/svelte'
import { useMirrorlessQuery as useSolidQuery, MirrorlessQuery as SolidQuery } from 'mirrorless/solid'
import { injectMirrorlessQuery, provideMirrorless } from 'mirrorless/angular'
import { MirrorlessController } from 'mirrorless/lit'
import { bindQuery } from 'mirrorless/dom'

interface Task { id: string; title: string; done: boolean }
const runtime = createMirrorless({
  query: async (_name, params, context) => {
    const id: unknown = params.id
    const signal: AbortSignal = context.signal
    void id; void signal
    return [{ id: '1', title: 'Server input', done: false }]
  },
  command: async (_name, _params, context) => ({ ok: !context.signal.aborted }),
  virtualCommands: ['Refresh'],
  updates: { Save: ['GetTasks', ['GetTask', { id: Symbol.for('id') }]], Refresh: ['GetTasks'] },
})
const assignRuntime: MirrorlessRuntime = runtime
const observer: MirrorlessObserver<Task[]> = runtime.observe<Task[]>('GetTasks')
const snapshot: QuerySnapshot<Task[]> = observer.getSnapshot()
const tasks: Task[] | undefined = snapshot.data
void assignRuntime; void tasks
observer.subscribe(() => { const rows: Task[] | undefined = observer.getSnapshot().data; void rows })
const copied: OperationParams = cloneFrozenJson({ id: '1' })
const cell = new MirrorlessCell<QuerySnapshot<Task[]>>()
runtime.subscribeCell<Task[]>(cell, 'GetTasks')
runtime.command<{ ok: boolean }>('Save', copied).then(receipt => { const ok: boolean = receipt.ok; void ok })
// @ts-expect-error Operation names are strings, not numeric IDs.
runtime.observe(42)
// @ts-expect-error Query parameters must be objects, not arrays.
runtime.subscribe('GetTask', ['1'])
// @ts-expect-error Snapshots cannot be reassigned through the public API.
snapshot.data = []
// @ts-expect-error The selected generic data type is not implicitly any.
const incorrectRows: string = snapshot.data
void incorrectRows

const reactProps: ReactQueryProps<Task[]> = {
  id: 'GetTasks', runtime,
  children: rows => rows.map(row => createElement('span', { key: row.id }, row.title)),
  loading: props => createElement('span', null, props.loading ? 'Loading' : 'Waiting'),
}
createElement(ReactQuery<Task[]>, reactProps)
const reactResult = useReactQuery<Task[]>('GetTasks', {}, { runtime })
const reactRows: Task[] | undefined = reactResult.data
const preactRows: Task[] | undefined = usePreactQuery<Task[]>('GetTasks', {}, { runtime }).data
void reactRows; void preactRows
// @ts-expect-error Successful children receive Task[], not lifecycle metadata.
const invalidReactProps: ReactQueryProps<Task[]> = { id: 'GetTasks', children: rows => rows.status }
void invalidReactProps

const vue = useVueQuery<Task[]>(() => 'GetTasks', () => ({}), { runtime })
const vueRows: Task[] | undefined = vue.snapshot.value.data
const VueTaskQuery = VueQuery<Task[]>
void vueRows; void VueTaskQuery

const svelte = createSvelteQuery<Task[]>(runtime, 'GetTasks')
svelte.subscribe(current => { const rows: Task[] | undefined = current.data; void rows })
svelte.setQuery('GetTask', { id: '1' })
const SvelteTaskQuery = SvelteQuery<Task[]>
void SvelteTaskQuery

const solid = useSolidQuery<Task[]>(() => 'GetTasks', () => ({}), { runtime })
const solidRows: Task[] | undefined = solid().data
SolidQuery<Task[]>({ id: 'GetTasks', runtime, children: rows => rows.map(row => row.title) })
void solidRows

provideMirrorless(runtime)
const angular = injectMirrorlessQuery<Task[]>(() => 'GetTasks', () => ({}))
const angularRows: Task[] | undefined = angular.data()
void angularRows

declare const host: ReactiveControllerHost
const lit = new MirrorlessController<Task[]>(host, { runtime, id: 'GetTasks' })
const litRows: Task[] | undefined = lit.data
void litRows

const dom = bindQuery<Task[]>({
  runtime, id: 'GetTasks',
  render(rows) { const title: string | undefined = rows[0]?.title; void title },
  loading(current) { const pending: boolean = current.loading; void pending },
  error(current) { const failure: unknown = current.error; void failure },
})
dom.setQuery('GetTasks', { completed: true })
// @ts-expect-error The typed DOM renderer receives Task[] directly.
bindQuery<Task[]>({ runtime, id: 'GetTasks', render: (rows: QuerySnapshot<Task[]>) => { void rows } })
