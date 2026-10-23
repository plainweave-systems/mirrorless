import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MirrorlessProvider, MirrorlessQuery, useMirrorlessRuntime } from 'mirrorless/react'
import { createTaskRuntime, startLiveRefresh } from '../shared/task-api.js'
import '../shared/style.css'
import './styles.css'

const message = (error) => error instanceof Error ? error.message : String(error)

function Loading() {
  return <p role="status">Reading server data…</p>
}

function QueryFailure({ error, refetch }) {
  return (
    <div role="alert">
      <p>Could not read server data: {message(error)}</p>
      <button type="button" onClick={() => { void refetch().catch(() => {}) }}>Retry read</button>
    </div>
  )
}

function TaskList({ tasks, selectedId, pending, onSelect, onToggle, onDelete }) {
  if (tasks.length === 0) return <p>No tasks yet. Add one above.</p>
  return (
    <ul className="tasks">
      {tasks.map((task) => (
        <li key={task.id}>
          <label className="task-check">
            <input
              type="checkbox"
              checked={task.done}
              disabled={pending}
              onChange={(event) => onToggle(task.id, event.currentTarget.checked)}
            />
            <span>{task.title}{task.done ? ' — complete' : ''}</span>
          </label>
          <div className="task-actions">
            <button type="button" aria-pressed={selectedId === task.id} onClick={() => onSelect(task.id)}>
              {selectedId === task.id ? 'Viewing' : 'Details'}
            </button>
            <button type="button" disabled={pending} aria-label={`Delete ${task.title}`} onClick={() => onDelete(task.id)}>Delete</button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function App() {
  const runtime = useMirrorlessRuntime()
  // These are the only application-owned states: a draft, selection and interaction status.
  const [draft, setDraft] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [live, setLive] = useState(false)
  const busy = useRef(false)

  useEffect(() => {
    if (!live) return undefined
    return startLiveRefresh(runtime, 2000, { onError: (error) => setActionError(message(error)) })
  }, [runtime, live])

  async function command(name, params, afterSuccess) {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setActionError(null)
    try {
      await runtime.command(name, params)
      afterSuccess?.()
    } catch (error) {
      setActionError(message(error))
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  function addTask(event) {
    event.preventDefault()
    const title = draft.trim()
    if (title) void command('CreateTask', { title }, () => setDraft(''))
  }

  return (
    <main>
      <header>
        <p className="eyebrow">Mirrorless · React · JavaScript</p>
        <h1>Server data in. Local state stays local.</h1>
        <p>The list, summary, and selected detail are independent server reads. Commands refresh them through declared rules; this app never patches a fetched task array.</p>
      </header>

      <div className="toolbar">
        <label><input type="checkbox" checked={live} onChange={(event) => setLive(event.currentTarget.checked)} /> Live refresh every 2 seconds</label>
        <button type="button" disabled={pending} onClick={() => { void command('RefreshTasks') }}>Refresh server inputs</button>
      </div>
      <p className="hint">Open another tab to try external changes. Enable live refresh to receive those changes without a special backend protocol.</p>
      {actionError && <p role="alert">Command failed: {actionError}</p>}
      <p className="interaction-status" role="status">{pending ? 'Waiting for the server to confirm…' : 'Ready'}</p>

      <div className="columns">
        <section aria-labelledby="tasks-heading">
          <h2 id="tasks-heading">Tasks</h2>
          <form onSubmit={addTask}>
            <label className="draft-label" htmlFor="task-title">New task</label>
            <input id="task-title" type="text" value={draft} maxLength={200} required placeholder="What needs doing?" onChange={(event) => setDraft(event.currentTarget.value)} />
            <button type="submit" disabled={pending || !draft.trim()}>Add task</button>
          </form>
          <MirrorlessQuery id="GetTasks" loading={Loading} error={QueryFailure}>
            {(tasks) => <TaskList tasks={tasks} pending={pending} selectedId={selectedId} onSelect={setSelectedId}
              onToggle={(id, done) => { void command('UpdateTask', { id, done }) }}
              onDelete={(id) => { void command('DeleteTask', { id }, () => setSelectedId((current) => current === id ? null : current)) }} />}
          </MirrorlessQuery>
        </section>

        <div>
          <aside aria-labelledby="summary-heading">
            <h2 id="summary-heading">Independent summary</h2>
            <MirrorlessQuery id="GetSummary" loading={Loading} error={QueryFailure}>
              {(summary) => <p aria-live="polite"><strong>{summary.done}</strong> of <strong>{summary.total}</strong> tasks complete.</p>}
            </MirrorlessQuery>
          </aside>
          <aside aria-labelledby="detail-heading">
            <h2 id="detail-heading">Selected detail</h2>
            {selectedId === null ? <p>Select a task to declare another read.</p> : (
              <MirrorlessQuery id="GetTask" params={{ id: selectedId }} loading={Loading} error={QueryFailure}>
                {(task) => <><h3>{task.title}</h3><p>{task.done ? 'Complete' : 'Open'}</p><small>Server task ID: {task.id}</small></>}
              </MirrorlessQuery>
            )}
          </aside>
        </div>
      </div>
      <footer className="hint">No client-side task store, reducer, normalized entity cache, or optimistic array patches.</footer>
    </main>
  )
}

// This entry point runs only in the browser. SSR applications create one runtime per session/request.
const runtime = createTaskRuntime()
const root = createRoot(document.getElementById('app'))
root.render(<StrictMode><MirrorlessProvider runtime={runtime}><App /></MirrorlessProvider></StrictMode>)

if (import.meta.hot) {
  import.meta.hot.dispose(() => { root.unmount(); runtime.dispose() })
}
