<script lang="ts">
  import { onDestroy } from 'svelte'
  import { provideMirrorless } from 'mirrorless/svelte'
  import { createTaskRuntime, startLiveRefresh } from '../../shared/task-api.js'
  import TaskList from './TaskList.svelte'
  import TaskSummary from './TaskSummary.svelte'
  import TaskDetail from './TaskDetail.svelte'

  // One runtime for this mounted application, never a cross-request singleton.
  const runtime = createTaskRuntime()
  provideMirrorless(runtime)
  onDestroy(() => runtime.dispose())

  // These are client-local concerns. There is no Svelte-owned task collection.
  let draft = $state('')
  let pending = $state(false)
  let commandError = $state('')
  let selectedId = $state<string | undefined>()
  let live = $state(false)

  function message(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }

  async function createTask(event: SubmitEvent) {
    event.preventDefault()
    const title = draft.trim()
    if (!title || pending) return
    pending = true
    commandError = ''
    try {
      await runtime.command('CreateTask', { title })
      draft = ''
    } catch (error) {
      commandError = message(error)
    } finally {
      pending = false
    }
  }

  async function refresh() {
    try {
      await runtime.command('RefreshTasks')
    } catch (error) {
      commandError = message(error)
    }
  }

  $effect(() => {
    if (!live) return
    return startLiveRefresh(runtime, 2000, { onError: (error) => { commandError = message(error) } })
  })
</script>

<main>
  <h1>Mirrorless + Svelte</h1>
  <p>Server data flows into components. Drafts, selection, and pending actions stay local.</p>
  <p class="hint">This page talks to a real HTTP server. No client-side task store, entity patches, or copied summary counts.</p>

  <section aria-labelledby="create-title">
    <h2 id="create-title">Create a task</h2>
    <form onsubmit={createTask}>
      <label class="draft-label" for="new-task">Task title</label>
      <input id="new-task" type="text" bind:value={draft} disabled={pending} autocomplete="off" required />
      <button type="submit" disabled={pending || !draft.trim()}>{pending ? 'Creating…' : 'Add task'}</button>
    </form>
    {#if pending}<p role="status">Waiting for the server to confirm the new task.</p>{/if}
    {#if commandError}<p role="alert">{commandError}</p>{/if}
    <div class="live-controls">
      <label><input type="checkbox" bind:checked={live} /> Live refresh every two seconds</label>
      <button type="button" onclick={refresh}>Refresh reads</button>
    </div>
    <small>Enable live refresh in two windows to see changes made by another client.</small>
  </section>

  <div class="columns">
    <TaskList
      {selectedId}
      onSelect={(id) => { selectedId = id }}
      onRemoved={(id) => { if (selectedId === id) selectedId = undefined }}
    />
    <div>
      <TaskSummary />
      {#if selectedId}
        <TaskDetail id={selectedId} />
      {:else}
        <aside><p>Select a task for a separately subscribed detail read.</p></aside>
      {/if}
    </div>
  </div>
</main>

<style>
  .draft-label { width: 100%; }
  .live-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; margin-block: 1rem; }
  :global(button:hover:not(:disabled)) { filter: brightness(.96); }
  :global(button:active:not(:disabled)) { transform: translateY(1px); }
  @media (prefers-reduced-motion: reduce) {
    :global(button:active:not(:disabled)) { transform: none; }
  }
</style>
