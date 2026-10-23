<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { MirrorlessQuery, useMirrorlessRuntime } from 'mirrorless/vue'
import { startLiveRefresh } from '../shared/task-api.js'
import type { Task, TaskSummary as SummaryData } from '../shared/task-api.js'
import TaskList from './TaskList.vue'
import TaskSummary from './TaskSummary.vue'
import TaskDetail from './TaskDetail.vue'

// Type specialization only: all three boundaries use the same runtime component.
const Tasks = MirrorlessQuery<Task[]>
const Summary = MirrorlessQuery<SummaryData>
const Detail = MirrorlessQuery<Task>
const runtime = useMirrorlessRuntime()

// These are genuinely local UI state, not copies of server tasks or counts.
const draft = ref('')
const pending = ref(false)
const commandError = ref('')
const selectedId = ref<string>()
const live = ref(false)
const liveError = ref('')
let stopLive: (() => void) | undefined

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

watch(live, (enabled) => {
  stopLive?.()
  stopLive = undefined
  liveError.value = ''
  if (enabled) {
    stopLive = startLiveRefresh(runtime, 2000, {
      onError: (error) => { liveError.value = message(error) },
    })
  }
})
onBeforeUnmount(() => stopLive?.())

async function execute(name: string, params: Record<string, unknown> = {}): Promise<boolean> {
  if (pending.value) return false
  pending.value = true
  commandError.value = ''
  try {
    await runtime.command(name, params)
    return true
  } catch (error) {
    commandError.value = message(error)
    return false
  } finally {
    pending.value = false
  }
}

async function createTask() {
  const title = draft.value.trim()
  if (title && await execute('CreateTask', { title })) draft.value = ''
}

async function toggleTask(task: Task) {
  await execute('UpdateTask', { id: task.id, done: !task.done })
}
</script>

<template>
  <main>
    <header>
      <p class="hint">Mirrorless + Vue 3 · TypeScript</p>
      <h1>Server data, not another client store.</h1>
      <p>Create or complete a task. The list, summary, and selected detail refresh through declared update rules.</p>
    </header>

    <section aria-labelledby="create-title">
      <h2 id="create-title">Add a task</h2>
      <form @submit.prevent="createTask">
        <label class="draft-label" for="new-task">Task title</label>
        <input id="new-task" v-model="draft" type="text" required maxlength="200" autocomplete="off" :disabled="pending" />
        <button type="submit" :disabled="pending || !draft.trim()">{{ pending ? 'Waiting for server…' : 'Add task' }}</button>
      </form>
      <p v-if="commandError" role="alert">Command failed: {{ commandError }}</p>
      <div class="live-controls">
        <label><input v-model="live" type="checkbox" /> Refresh interested reads every 2 seconds</label>
        <button :disabled="pending" @click="execute('RefreshTasks')">Refresh now</button>
      </div>
      <p class="hint">Open another browser window and enable refresh to see changes made there. No server state is patched locally.</p>
      <p v-if="liveError" role="alert">Live refresh failed: {{ liveError }}</p>
    </section>

    <div class="columns">
      <section aria-labelledby="tasks-title" :aria-busy="pending">
        <h2 id="tasks-title">Tasks</h2>
        <Tasks id="GetTasks">
          <template #default="{ data }">
            <TaskList :tasks="data" :pending="pending" :selected-id="selectedId" @toggle="toggleTask" @select="selectedId = $event" />
          </template>
          <template #loading><p role="status">Loading tasks…</p></template>
          <template #error="snapshot"><p role="alert">Could not load tasks: {{ message(snapshot.error) }}</p></template>
        </Tasks>
      </section>

      <aside aria-labelledby="summary-title">
        <h2 id="summary-title">Server summary</h2>
        <Summary id="GetSummary">
          <template #default="{ data }"><TaskSummary :summary="data" /></template>
          <template #loading><p role="status">Loading summary…</p></template>
          <template #error="snapshot"><p role="alert">Could not load summary: {{ message(snapshot.error) }}</p></template>
        </Summary>
      </aside>
    </div>

    <section aria-labelledby="details-title">
      <h2 id="details-title">Selected task</h2>
      <Detail v-if="selectedId" id="GetTask" :params="{ id: selectedId }">
        <template #default="{ data }"><TaskDetail :task="data" /></template>
        <template #loading><p role="status">Loading this task…</p></template>
        <template #error="snapshot"><p role="alert">Could not load this task: {{ message(snapshot.error) }}</p></template>
      </Detail>
      <p v-else class="hint">Choose Details on a task to declare interest in that task.</p>
    </section>

    <footer><p class="hint">TaskList, TaskSummary, and TaskDetail receive ordinary data props. Their source is the HTTP server.</p></footer>
  </main>
</template>

<style scoped>
.draft-label { flex-basis: 100%; }
.live-controls { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; }
</style>
