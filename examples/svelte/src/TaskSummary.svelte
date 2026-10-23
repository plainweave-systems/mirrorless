<script lang="ts">
  import { MirrorlessQuery } from 'mirrorless/svelte'
  import type { QuerySnapshot } from 'mirrorless'
  import type { TaskSummary } from '../../shared/task-api.js'
  const SummaryQuery = MirrorlessQuery<TaskSummary>
</script>

<aside aria-labelledby="summary-title">
  <h2 id="summary-title">Server summary</h2>
  <SummaryQuery id="GetSummary">
    {#snippet loading(_snapshot: QuerySnapshot<TaskSummary>)}
      <p role="status">Loading summary…</p>
    {/snippet}
    {#snippet error(snapshot: QuerySnapshot<TaskSummary>)}
      <p role="alert">Summary unavailable: {snapshot.error instanceof Error ? snapshot.error.message : String(snapshot.error)}</p>
    {/snippet}
    {#snippet children(summary: TaskSummary)}
      <p><strong>{summary.done}</strong> of <strong>{summary.total}</strong> tasks done.</p>
      <small>This count comes from a separate server read, not from reducing a client-owned task collection.</small>
    {/snippet}
  </SummaryQuery>
</aside>
