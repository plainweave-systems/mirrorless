<script lang="ts">
  import { MirrorlessQuery } from 'mirrorless/svelte'
  import type { MirrorlessRuntime, OperationParams, QuerySnapshot } from 'mirrorless'

  let {
    runtime,
    id = 'Read',
    params = {},
    localError = true,
    onData,
  }: {
    runtime: MirrorlessRuntime
    id?: string
    params?: OperationParams
    localError?: boolean
    onData?: (value: { id: string; params: OperationParams; data: unknown }) => void
  } = $props()

  export function setQuery(nextId: string, nextParams: OperationParams = {}) {
    id = nextId
    params = nextParams
  }

  export function setRuntime(nextRuntime: MirrorlessRuntime) {
    runtime = nextRuntime
  }

  function capture(data: unknown) {
    onData?.({ id, params, data })
    return ''
  }
</script>

{#snippet loading(snapshot: QuerySnapshot)}
  <p role="status" data-operation={snapshot.operationName}>Loading</p>
{/snippet}

{#snippet failure(snapshot: QuerySnapshot)}
  <p role="alert">{snapshot.error instanceof Error ? snapshot.error.message : String(snapshot.error)}</p>
{/snippet}

<MirrorlessQuery {runtime} {id} {params} {loading} error={localError ? failure : undefined}>
  {#snippet children(data: unknown)}
    <output data-testid="data">{capture(data)}{JSON.stringify(data)}</output>
  {/snippet}
</MirrorlessQuery>
