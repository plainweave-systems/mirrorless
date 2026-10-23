<script lang="ts">
  import { MirrorlessQuery } from 'mirrorless/svelte'
  import type { QuerySnapshot } from 'mirrorless'
  import type { Task } from '../../shared/task-api.js'
  const TaskQuery = MirrorlessQuery<Task>
  let { id }: { id: string } = $props()
</script>

<aside aria-labelledby="detail-title">
  <h2 id="detail-title">Task detail</h2>
  <TaskQuery id="GetTask" params={{ id }}>
    {#snippet loading(_snapshot: QuerySnapshot<Task>)}
      <p role="status">Loading selected task…</p>
    {/snippet}
    {#snippet error(snapshot: QuerySnapshot<Task>)}
      <p role="alert">Task unavailable: {snapshot.error instanceof Error ? snapshot.error.message : String(snapshot.error)}</p>
    {/snippet}
    {#snippet children(task: Task)}
      <h3>{task.title}</h3>
      <p>{task.done ? 'Done' : 'Open'} · Task {task.id}</p>
      <small>The UpdateTask rule targets this read only when its id matches the changed task.</small>
    {/snippet}
  </TaskQuery>
</aside>
