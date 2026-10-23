// Copyright 2026 Plainweave Systems. SPDX-License-Identifier: Apache-2.0
import { LitElement, html, type TemplateResult } from 'lit'
import type { OperationParams } from 'mirrorless'
import { MirrorlessController } from 'mirrorless/lit'
import { createTaskRuntime, startLiveRefresh, type Task, type TaskSummary } from '../../shared/task-api.js'
import '../../shared/style.css'
import './style.css'

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Every mutable field below concerns local interaction, never server entities. */
class MirrorlessLitDemo extends LitElement {
  static properties = {
    draft: { state: true },
    pending: { state: true },
    commandError: { state: true },
    selectedId: { state: true },
    live: { state: true },
    liveError: { state: true },
  }

  declare draft: string
  declare pending: boolean
  declare commandError: string
  declare selectedId: string | undefined
  declare live: boolean
  declare liveError: string

  private readonly runtime = createTaskRuntime()
  private readonly tasks = new MirrorlessController<Task[]>(this, { runtime: this.runtime, id: 'GetTasks' })
  private readonly summary = new MirrorlessController<TaskSummary>(this, { runtime: this.runtime, id: 'GetSummary' })
  private detail: MirrorlessController<Task> | undefined
  private stopLive: (() => void) | undefined

  constructor() {
    super()
    this.draft = ''
    this.pending = false
    this.commandError = ''
    this.selectedId = undefined
    this.live = false
    this.liveError = ''
  }

  // Light DOM lets this small example use the common example stylesheet.
  protected createRenderRoot() { return this }

  connectedCallback() {
    super.connectedCallback()
    if (this.live) this.startLive()
  }

  disconnectedCallback() {
    this.stopLive?.()
    this.stopLive = undefined
    super.disconnectedCallback()
  }

  dispose() {
    this.stopLive?.()
    this.stopLive = undefined
    this.runtime.dispose()
  }

  private startLive() {
    this.stopLive?.()
    this.liveError = ''
    this.stopLive = startLiveRefresh(this.runtime, 2000, {
      onError: (error) => { this.liveError = describeError(error) },
    })
  }

  private setLive(event: Event) {
    this.live = (event.currentTarget as HTMLInputElement).checked
    if (this.live) this.startLive()
    else {
      this.stopLive?.()
      this.stopLive = undefined
      this.liveError = ''
    }
  }

  private async command(name: string, params: OperationParams = {}, succeeded?: () => void) {
    if (this.pending) return
    this.pending = true
    this.commandError = ''
    try {
      await this.runtime.command(name, params)
      succeeded?.()
    } catch (error) {
      this.commandError = describeError(error)
    } finally {
      this.pending = false
    }
  }

  private createTask(event: SubmitEvent) {
    event.preventDefault()
    const title = this.draft.trim()
    if (!title) return
    void this.command('CreateTask', { title }, () => { this.draft = '' })
  }

  private toggleTask(event: Event, task: Task) {
    const checkbox = event.currentTarget as HTMLInputElement
    const done = checkbox.checked
    // The browser toggles a checkbox before change fires. Restore confirmed
    // data until the server accepts the command and affected reads return.
    checkbox.checked = task.done
    void this.command('UpdateTask', { id: task.id, done })
  }

  private selectTask(id: string) {
    this.selectedId = id
    if (this.detail) this.detail.setQuery('GetTask', { id })
    else this.detail = new MirrorlessController<Task>(this, { runtime: this.runtime, id: 'GetTask', params: { id } })
  }

  private deleteTask(id: string) {
    void this.command('DeleteTask', { id }, () => {
      if (this.selectedId !== id) return
      this.selectedId = undefined
      this.detail?.dispose()
      this.detail = undefined
    })
  }

  private read<T>(query: MirrorlessController<T>, label: string, renderData: (data: T) => TemplateResult): TemplateResult {
    const snapshot = query.snapshot
    if (snapshot.data !== undefined) return renderData(snapshot.data)
    if (snapshot.status === 'error') {
      return html`<p role="alert">${describeError(snapshot.error)}</p>
        <button @click=${() => { void query.refetch().catch(() => {}) }}>Retry ${label}</button>`
    }
    return html`<p role="status" aria-live="polite">Loading ${label}…</p>`
  }

  private renderTasks(tasks: Task[]): TemplateResult {
    if (tasks.length === 0) return html`<p>No tasks yet. Add one above.</p>`
    return html`<ul>${tasks.map((task) => html`
      <li class="task-row">
        <label>
          <input type="checkbox" .checked=${task.done} ?disabled=${this.pending}
            @change=${(event: Event) => this.toggleTask(event, task)}>
          ${task.done ? html`<s>${task.title}</s>` : task.title}
        </label>
        <button ?disabled=${this.pending} aria-pressed=${this.selectedId === task.id}
          @click=${() => this.selectTask(task.id)}>Details</button>
        <button ?disabled=${this.pending} @click=${() => this.deleteTask(task.id)}
          aria-label=${`Delete ${task.title}`}>Delete</button>
      </li>
    `)}</ul>`
  }

  protected render() {
    return html`
      <main>
        <h1>Mirrorless + Lit</h1>
        <p>Server data flows into components. Drafts, selection, and pending interactions stay local.</p>
        <div class="toolbar">
          <label><input type="checkbox" .checked=${this.live} @change=${this.setLive}> Live refresh every 2 seconds</label>
          <button ?disabled=${this.pending} @click=${() => { void this.command('RefreshTasks') }}>Refresh now</button>
        </div>
        <p class="hint">Open a second tab with live refresh enabled to see changes made by another client.</p>
        ${this.liveError ? html`<p role="alert">Live refresh: ${this.liveError}</p>` : ''}
        <form @submit=${this.createTask} aria-label="Add a task">
          <input type="text" aria-label="Task title" placeholder="A new task" .value=${this.draft}
            ?disabled=${this.pending} @input=${(event: Event) => { this.draft = (event.currentTarget as HTMLInputElement).value }}>
          <button type="submit" ?disabled=${this.pending || !this.draft.trim()}>${this.pending ? 'Waiting for server…' : 'Add task'}</button>
        </form>
        ${this.commandError ? html`<p role="alert">${this.commandError}</p>` : ''}
        <div class="columns">
          <section aria-label="Tasks" aria-busy=${this.pending}>
            <h2>Tasks</h2>
            ${this.read(this.tasks, 'tasks', (tasks) => this.renderTasks(tasks))}
          </section>
          <aside aria-label="Server summary">
            <h2>Server summary</h2>
            ${this.read(this.summary, 'summary', (summary) => html`<p>${summary.done} of ${summary.total} tasks complete.</p>`)}
            <p class="hint">A separate read, refreshed by the same command rules. No browser-maintained count.</p>
          </aside>
        </div>
        ${this.detail && this.selectedId ? html`
          <section aria-label="Selected task">
            <h2>Selected task</h2>
            ${this.read(this.detail, 'task details', (task) => html`
              <p><strong>${task.title}</strong></p>
              <p>${task.done ? 'Complete' : 'Not complete'} · <code>${task.id}</code></p>
            `)}
          </section>
        ` : ''}
      </main>
    `
  }
}

customElements.define('mirrorless-lit-demo', MirrorlessLitDemo)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const element of document.querySelectorAll<MirrorlessLitDemo>('mirrorless-lit-demo')) element.dispose()
  })
}
