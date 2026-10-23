import { createEffect, createMemo, createSignal, ErrorBoundary, For, onCleanup, Show } from 'solid-js'
import type { Component } from 'solid-js'
import { render } from 'solid-js/web'
import {
  MirrorlessProvider,
  MirrorlessQuery,
  useMirrorlessRuntime,
} from 'mirrorless/solid'
import type { OperationParams, QuerySnapshot } from 'mirrorless'
import { createTaskRuntime, startLiveRefresh } from '../../shared/task-api.js'
import '../../shared/style.css'
import './style.css'

type Task = { id: string; title: string; done: boolean }
type Summary = { total: number; done: number }

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function App() {
  const runtime = createMemo(useMirrorlessRuntime)
  // Only actual client-local state: draft, selection, pending interaction,
  // command error, and whether this browser should request live refreshes.
  const [draft, setDraft] = createSignal('')
  const [selected, setSelected] = createSignal<string>()
  const [pending, setPending] = createSignal(false)
  const [commandError, setCommandError] = createSignal('')
  const [live, setLive] = createSignal(false)
  let input: HTMLInputElement | undefined

  createEffect(() => {
    if (live()) onCleanup(startLiveRefresh(runtime(), 2000))
  })

  async function command(name: string, params: OperationParams = {}): Promise<boolean> {
    if (pending()) return false
    setPending(true)
    setCommandError('')
    try {
      await runtime().command(name, params)
      return true
    } catch (error) {
      setCommandError(message(error))
      return false
    } finally {
      setPending(false)
    }
  }

  async function addTask(event: SubmitEvent) {
    event.preventDefault()
    const title = draft().trim()
    if (!title) return
    if (await command('CreateTask', { title })) {
      setDraft('')
      input?.focus()
    }
  }

  async function deleteTask(id: string) {
    if (await command('DeleteTask', { id })) {
      if (selected() === id) setSelected(undefined)
    }
  }

  const QueryError: Component<QuerySnapshot<unknown>> = (props) => (
    <div class="query-error" role="alert">
      <p>Could not load this view: {message(props.error)}</p>
      <button disabled={pending()} onClick={() => void command('RefreshTasks')}>Retry reads</button>
    </div>
  )

  const SummaryView: Component<{ data: Summary }> = (props) => (
    <div class="summary-values" aria-live="polite">
      <div><strong>{props.data.total}</strong><span>Total tasks</span></div>
      <div><strong>{props.data.done}</strong><span>Completed</span></div>
    </div>
  )

  const TaskList: Component<{ data: Task[] }> = (props) => (
    <Show when={props.data.length > 0} fallback={<p class="empty">No tasks yet. Add the first one above.</p>}>
      <ul class="task-list">
        <For each={props.data}>{(task) => (
          <li class="task-row">
            <button
              class="task-title"
              classList={{ selected: selected() === task.id }}
              aria-pressed={selected() === task.id}
              onClick={() => setSelected(task.id)}
            >
              <span>{task.title}</span>
              <span class="task-status">{task.done ? 'Complete' : 'Open'}</span>
            </button>
            <div class="task-actions">
              <button
                disabled={pending()}
                aria-label={`${task.done ? 'Reopen' : 'Complete'} ${task.title}`}
                onClick={() => void command('UpdateTask', { id: task.id, done: !task.done })}
              >{task.done ? 'Reopen' : 'Complete'}</button>
              <button class="quiet" disabled={pending()} aria-label={`Delete ${task.title}`} onClick={() => void deleteTask(task.id)}>
                Delete
              </button>
            </div>
          </li>
        )}</For>
      </ul>
    </Show>
  )

  const DetailView: Component<{ data: Task }> = (props) => (
    <dl class="task-detail">
      <div><dt>Title</dt><dd>{props.data.title}</dd></div>
      <div><dt>Status</dt><dd>{props.data.done ? 'Complete' : 'Open'}</dd></div>
      <div><dt>Server ID</dt><dd><code>{props.data.id}</code></dd></div>
    </dl>
  )

  return (
    <main class="demo">
      <header class="intro">
        <p class="eyebrow">Mirrorless / Solid + TypeScript</p>
        <h1>Server data flows.<br />Client state stays local.</h1>
        <p>The list, summary, and selected detail are independent reads of a real HTTP API. Commands refresh them through declared rules, not client-side patches.</p>
      </header>

      <section class="panel controls" aria-labelledby="create-heading">
        <h2 id="create-heading">Create a task</h2>
        <form onSubmit={(event) => void addTask(event)}>
          <label for="task-title">Task title</label>
          <div class="input-row">
            <input ref={input} id="task-title" name="title" autocomplete="off" maxlength="200" value={draft()} onInput={(event) => setDraft(event.currentTarget.value)} />
            <button type="submit" disabled={pending() || !draft().trim()}>{pending() ? 'Working…' : 'Add task'}</button>
          </div>
        </form>
        <div class="refresh-row">
          <label class="checkbox-label"><input type="checkbox" checked={live()} onChange={(event) => setLive(event.currentTarget.checked)} />Live refresh every 2 seconds</label>
          <button class="quiet" disabled={pending()} onClick={() => void command('RefreshTasks')}>Refresh now</button>
        </div>
        <p class="hint">Enable live refresh in two browser tabs to see changes made by the other client.</p>
        <p class="interaction-status" role="status" aria-live="polite">{pending() ? 'Waiting for the server and affected reads…' : 'Server data is not updated optimistically.'}</p>
        <Show when={commandError()}><p class="command-error" role="alert">{commandError()}</p></Show>
      </section>

      <ErrorBoundary fallback={(error, reset) => (
        <section class="panel query-error" role="alert">
          <h2>This view failed</h2><p>{message(error)}</p>
          <button onClick={() => { void runtime().command('RefreshTasks').catch((reason) => setCommandError(message(reason))).finally(reset) }}>Try again</button>
        </section>
      )}>
        <div class="view-grid">
          <section class="panel" aria-labelledby="tasks-heading">
            <h2 id="tasks-heading">Tasks <span class="source-label">GetTasks</span></h2>
            <MirrorlessQuery<Task[]> id="GetTasks" loading={<p role="status">Loading tasks…</p>} error={QueryError} component={TaskList} />
          </section>
          <aside class="side-views">
            <section class="panel" aria-labelledby="summary-heading">
              <h2 id="summary-heading">Summary <span class="source-label">GetSummary</span></h2>
              <MirrorlessQuery<Summary> id="GetSummary" loading={<p role="status">Loading summary…</p>} error={QueryError} component={SummaryView} />
            </section>
            <section class="panel" aria-labelledby="detail-heading">
              <h2 id="detail-heading">Selected task</h2>
              <Show when={selected()} keyed fallback={<p class="empty">Select a task title to declare interest in its detail.</p>}>{(id) => (
                <MirrorlessQuery<Task> id="GetTask" params={{ id }} loading={<p role="status">Loading detail…</p>} error={QueryError} component={DetailView} />
              )}</Show>
            </section>
          </aside>
        </div>
      </ErrorBoundary>
    </main>
  )
}

const host = document.getElementById('app')
if (!host) throw new Error('Missing #app root')
const runtime = createTaskRuntime()
const dispose = render(() => <MirrorlessProvider runtime={runtime}><App /></MirrorlessProvider>, host)
if (import.meta.hot) {
  import.meta.hot.dispose(() => { dispose(); runtime.dispose() })
}
