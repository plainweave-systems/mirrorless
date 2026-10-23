<script setup lang="ts">
import type { Task } from '../shared/task-api.js'

defineProps<{ task: Task }>()
</script>

<template>
  <dl>
    <dt>Title</dt><dd>{{ task.title }}</dd>
    <dt>Server status</dt><dd>{{ task.done ? 'Complete' : 'Not complete' }}</dd>
    <dt>ID</dt><dd>{{ task.id }}</dd>
  </dl>
  <p class="hint">A selected task declares its own parameterized read.</p>
</template>

<style scoped>
dt { font-weight: 600; margin-top: .6rem; }
dd { margin-left: 0; overflow-wrap: anywhere; }
</style>
