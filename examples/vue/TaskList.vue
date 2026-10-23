<script setup lang="ts">
import type { Task } from '../shared/task-api.js'

defineProps<{
  tasks: readonly Task[]
  pending: boolean
  selectedId?: string
}>()

defineEmits<{
  toggle: [task: Task]
  select: [id: string]
}>()
</script>

<template>
  <p v-if="tasks.length === 0" class="hint">No tasks yet. Add one above.</p>
  <ul v-else class="task-list">
    <li v-for="task in tasks" :key="task.id">
      <div class="task-copy">
        <strong>{{ task.title }}</strong>
        <span class="hint">{{ task.done ? 'Complete' : 'Not complete' }}</span>
      </div>
      <div class="task-actions">
        <button :disabled="pending" :aria-pressed="task.done" @click="$emit('toggle', task)">
          {{ task.done ? 'Mark not done' : 'Mark done' }}
        </button>
        <button :aria-pressed="selectedId === task.id" @click="$emit('select', task.id)">
          {{ selectedId === task.id ? 'Selected' : 'Details' }}
        </button>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.task-list { padding: 0; list-style: none; }
.task-list li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; padding-block: .8rem; }
.task-copy { display: grid; gap: .2rem; overflow-wrap: anywhere; }
.task-copy .hint { font-size: .85rem; }
.task-actions { display: flex; flex-wrap: wrap; gap: .4rem; }
button[aria-pressed=true] { font-weight: 700; border-width: 2px; }
</style>
