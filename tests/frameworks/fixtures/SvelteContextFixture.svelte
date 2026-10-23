<script lang="ts">
  import { untrack } from 'svelte'
  import { MirrorlessQuery, provideMirrorless, useMirrorlessRuntime } from 'mirrorless/svelte'
  import type { MirrorlessRuntime } from 'mirrorless'

  let { runtime, onRuntime }: {
    runtime: MirrorlessRuntime
    onRuntime?: (value: MirrorlessRuntime) => void
  } = $props()
  provideMirrorless(untrack(() => runtime))
  untrack(() => onRuntime?.(useMirrorlessRuntime()))
</script>

<MirrorlessQuery id="Read">
  {#snippet children(data: unknown)}
    <output>{JSON.stringify(data)}</output>
  {/snippet}
</MirrorlessQuery>
