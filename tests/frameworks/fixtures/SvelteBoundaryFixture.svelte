<script lang="ts">
  import SvelteQueryFixture from './SvelteQueryFixture.svelte'
  import type { MirrorlessRuntime } from 'mirrorless'
  let { runtime }: { runtime: MirrorlessRuntime } = $props()
</script>

<svelte:boundary>
  <SvelteQueryFixture {runtime} localError={false} />
  {#snippet failed(error: unknown)}
    <p role="alert" data-testid="boundary">Boundary: {error instanceof Error ? error.message : String(error)}</p>
  {/snippet}
</svelte:boundary>
