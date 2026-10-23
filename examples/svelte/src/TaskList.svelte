<script lang="ts">
  import { MirrorlessQuery, useMirrorlessRuntime } from 'mirrorless/svelte'
  import type { QuerySnapshot } from 'mirrorless'
  import type { Task } from '../../shared/task-api.js'
  const TasksQuery = MirrorlessQuery<Task[]>

  let { selectedId, onSelect, onRemoved }: {
    selectedId?: string
    onSelect: (id: string) => void
    onRemoved: (id: string) => void
  } = $props()
  const runtime = useMirrorlessRuntime()
  let pendingId = $state<string | undefined>()
  let commandError = $state('')

  async function run(name: string, task: Task) {
    if (pendingId) return
    pendingId = task.id
    commandError = ''
    try {
      await runtime.command(name, name === 'UpdateTask' ? { id: task.id, done: !task.done } : { id: task.id })
      if (name === 'DeleteTask') onRemoved(task.id)
    } catch (error) {
      commandError = error instanceof Error ? error.message : String(error)
    } finally {
      pendingId = undefined
    }
  }
</script>

<section aria-labelledby="tasks-title">
  <h2 id="tasks-title">Tasks</h2>
  {#if commandError}<p role="alert">{commandError}</p>{/if}
  {#if pendingId}<p role="status">Waiting for the server. Confirmed data stays visible.</p>{/if}

  <TasksQuery id="GetTasks">
    {#snippet loading(_snapshot: QuerySnapshot<Task[]>)}
      <p role="status">Loading tasks…</p>
    {/snippet}
    {#snippet error(snapshot: QuerySnapshot<Task[]>)}
      <p role="alert">Could not load tasks: {snapshot.error instanceof Error ? snapshot.error.message : String(snapshot.error)}</p>
      <button type="button" onclick={() => runtime.command('RefreshTasks')}>Retry reads</button>
    {/snippet}
    {#snippet children(tasks: Task[])}
      {#if tasks.length === 0}
        <p>No tasks yet. Add one above.</p>
      {:else}
        <ul class="tasks">
          {#each tasks as task (task.id)}
            <li>
              <div class="task-heading">
                <strong>{task.title}</strong>
                <span>{task.done ? 'Done' : 'Open'}</span>
              </div>
              <div class="actions">
                <button type="button" disabled={Boolean(pendingId)} onclick={() => run('UpdateTask', task)}>
                  {pendingId === task.id ? 'Waiting…' : task.done ? 'Mark open' : 'Mark done'}
                </button>
                <button type="button" aria-pressed={selectedId === task.id} onclick={() => onSelect(task.id)}>
                  {selectedId === task.id ? 'Selected' : 'View details'}
                </button>
                <button type="button" disabled={Boolean(pendingId)} onclick={() => run('DeleteTask', task)} aria-label={`Delete ${task.title}`}>
                  Delete
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/snippet}
  </TasksQuery>
</section>

<style>
  .tasks { list-style: none; padding: 0; }
  .tasks li + li { margin-top: .75rem; }
  .task-heading, .actions { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; }
  .task-heading { margin-bottom: .5rem; justify-content: space-between; }
</style>
