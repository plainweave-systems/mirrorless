<script setup lang="ts">
import type { TaskSummary } from '../shared/task-api.js'

defineProps<{ summary: TaskSummary }>()
</script>

<template>
  <p><strong>{{ summary.done }} / {{ summary.total }}</strong> tasks complete</p>
  <p class="hint">This summary is a separate server read. No client-side count is maintained.</p>
</template>
