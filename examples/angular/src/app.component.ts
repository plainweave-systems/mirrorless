// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import { Component, effect, input, signal } from '@angular/core'
import { injectMirrorlessQuery, injectMirrorlessRuntime } from 'mirrorless/angular'
import { startLiveRefresh } from '../../shared/task-api.js'
import type { Task, TaskSummary } from '../../shared/task-api.js'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

@Component({
  selector: 'task-summary',
  standalone: true,
  template: `
    @let value = summary();
    @if (value.data !== undefined) {
      <p class="summary" aria-live="polite">
        <strong>{{ value.data.done }}</strong> of {{ value.data.total }} tasks complete
        @if (value.loading) { <small> · refreshing</small> }
      </p>
      @if (value.error) { <p role="alert">Summary refresh failed; showing its last result.</p> }
    } @else if (value.error) {
      <p role="alert">Unable to load the summary: {{ message(value.error) }}</p>
    } @else {
      <p role="status">Loading summary…</p>
    }
  `,
})
export class TaskSummaryComponent {
  readonly summary = injectMirrorlessQuery<TaskSummary>('GetSummary')
  readonly message = errorMessage
}

@Component({
  selector: 'task-detail',
  standalone: true,
  template: `
    @let value = task();
    @if (value.data !== undefined) {
      <h3>{{ value.data.title }}</h3>
      <p>{{ value.data.done ? 'Complete' : 'Not complete' }}</p>
      <small>Independent GetTask subscription for task {{ value.data.id }}.</small>
      @if (value.loading) { <p role="status">Refreshing task…</p> }
      @if (value.error) { <p role="alert">Refresh failed: {{ message(value.error) }}</p> }
    } @else if (value.error) {
      <p role="alert">Unable to load task: {{ message(value.error) }}</p>
      <button type="button" (click)="retry()">Retry detail</button>
    } @else {
      <p role="status">Loading task…</p>
    }
  `,
})
export class TaskDetailComponent {
  readonly taskId = input.required<string>()
  readonly task = injectMirrorlessQuery<Task>('GetTask', () => ({ id: this.taskId() }))
  readonly message = errorMessage

  retry(): void {
    // The resource exposes this failure to its template; avoid an unhandled promise.
    void this.task.refetch().catch(() => undefined)
  }
}

@Component({
  selector: 'mirrorless-angular-app',
  standalone: true,
  imports: [TaskSummaryComponent, TaskDetailComponent],
  template: `
    <main>
      <header>
        <p class="hint">Mirrorless / Angular signals</p>
        <h1>Server data is input. Keep local state local.</h1>
        <task-summary />
      </header>
      <p>
        The list, summary, and detail subscribe independently. Successful commands
        refresh their declared reads; no component patches a task array or counter.
      </p>

      <section aria-labelledby="new-task-heading">
        <h2 id="new-task-heading">Add a task</h2>
        <form (submit)="createTask($event)">
          <label class="visually-hidden" for="task-title">Task title</label>
          <input id="task-title" type="text" autocomplete="off" maxlength="200"
            placeholder="What needs doing?" [value]="draft()" (input)="updateDraft($event)"
            [disabled]="pending()" required>
          <button type="submit" [disabled]="pending() || !draft().trim()">Add task</button>
        </form>
        <div class="toolbar">
          <label><input type="checkbox" [checked]="live()" (change)="toggleLive($event)">
            Live refresh every two seconds</label>
          <button type="button" (click)="refresh()" [disabled]="pending()">Refresh now</button>
        </div>
        <p class="hint">Enable live refresh in two tabs to see writes from the other tab.</p>
        @if (pending()) { <p role="status">Waiting for the server…</p> }
        @if (commandError()) { <p role="alert">{{ commandError() }}</p> }
        @if (liveError()) { <p role="alert">Live refresh failed: {{ liveError() }}</p> }
      </section>

      <div class="columns">
        <section aria-labelledby="task-list-heading">
          <h2 id="task-list-heading">Tasks</h2>
          @let value = tasks();
          @if (value.data !== undefined) {
            @if (value.loading) { <p role="status">Refreshing tasks…</p> }
            @if (value.error) {
              <p role="alert">Refresh failed; showing the last result. {{ message(value.error) }}</p>
            }
            <ul class="task-list">
              @for (task of value.data; track task.id) {
                <li class="task-row">
                  <label><input type="checkbox" [checked]="task.done"
                    (change)="toggleTask(task, $event)" [disabled]="pending()">
                    <span [class.complete]="task.done">{{ task.title }}</span>
                  </label>
                  <button type="button" [attr.aria-pressed]="selectedId() === task.id"
                    (click)="selectedId.set(task.id)">Details</button>
                </li>
              } @empty {
                <li>No tasks yet. Add one above.</li>
              }
            </ul>
          } @else if (value.error) {
            <p role="alert">Unable to load tasks: {{ message(value.error) }}</p>
            <button type="button" (click)="retryTasks()">Retry tasks</button>
          } @else {
            <p role="status">Loading tasks…</p>
          }
        </section>
        <aside aria-labelledby="task-detail-heading">
          <h2 id="task-detail-heading">Selected task</h2>
          @if (selectedId(); as id) {
            <task-detail [taskId]="id" />
          } @else {
            <p>Select Details beside a task.</p>
          }
        </aside>
      </div>
      <p class="hint">Only the draft, selection, live switch, and pending/error feedback are local state.</p>
    </main>
  `,
})
export class AppComponent {
  private readonly runtime = injectMirrorlessRuntime()
  readonly tasks = injectMirrorlessQuery<Task[]>('GetTasks')
  readonly draft = signal('')
  readonly selectedId = signal<string | null>(null)
  readonly pending = signal(false)
  readonly commandError = signal<string | undefined>(undefined)
  readonly live = signal(false)
  readonly liveError = signal<string | undefined>(undefined)
  readonly message = errorMessage

  constructor() {
    effect((onCleanup) => {
      if (this.live()) {
        this.liveError.set(undefined)
        onCleanup(startLiveRefresh(this.runtime, 2000, {
          onError: (error) => this.liveError.set(errorMessage(error)),
        }))
      }
    })
  }

  updateDraft(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value)
  }

  toggleLive(event: Event): void {
    this.live.set((event.target as HTMLInputElement).checked)
    this.liveError.set(undefined)
  }

  createTask(event: Event): void {
    event.preventDefault()
    const title = this.draft().trim()
    if (!title || this.pending()) return
    void this.execute('CreateTask', { title }, () => this.draft.set(''))
  }

  toggleTask(task: Task, event: Event): void {
    const checkbox = event.target as HTMLInputElement
    const requested = checkbox.checked
    // The browser toggles the native control before dispatching change. Restore
    // the confirmed value while the command is pending, rather than displaying
    // an optimistic change or mutating the server response.
    checkbox.checked = task.done
    void this.execute('UpdateTask', { id: task.id, done: requested })
  }

  refresh(): void {
    void this.execute('RefreshTasks', {})
  }

  retryTasks(): void {
    void this.tasks.refetch().catch(() => undefined)
  }

  private async execute(name: string, params: Record<string, unknown>, afterSuccess?: () => void): Promise<void> {
    if (this.pending()) return
    this.pending.set(true)
    this.commandError.set(undefined)
    try {
      await this.runtime.command(name, params)
      afterSuccess?.()
    } catch (error) {
      this.commandError.set(errorMessage(error))
    } finally {
      this.pending.set(false)
    }
  }
}
