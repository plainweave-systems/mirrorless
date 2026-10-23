<!-- Copyright 2026 Plainweave Systems; SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts" generics="T = unknown">
  import { getContext, onMount, untrack } from 'svelte'
  import type { MirrorlessRuntime, QuerySnapshot } from 'mirrorless'
  import type { MirrorlessQueryProps } from './index.js'
  import { MIRRORLESS_CONTEXT } from './context.js'
  import { createMirrorlessQuery } from './resource.js'
  import { idleSnapshot, snapshotMatches, throwInitialError } from './snapshot.js'

  let {
    id,
    params = {},
    options = {},
    runtime,
    children,
    loading,
    error,
  }: MirrorlessQueryProps<T> = $props()

  const contextRuntime = getContext<MirrorlessRuntime | undefined>(MIRRORLESS_CONTEXT)
  const initialRuntime = untrack(() => runtime ?? contextRuntime)
  if (!initialRuntime) {
    throw new Error('MirrorlessQuery needs a runtime prop or provideMirrorless(runtime) in an ancestor')
  }

  let activeRuntime = $state.raw(initialRuntime)
  let resource = untrack(() => createMirrorlessQuery<T>(initialRuntime, id, params, options))
  let snapshot = $state.raw<QuerySnapshot<T>>(resource.getSnapshot())
  let mounted = false
  let stop: (() => void) | undefined

  // Do not use an auto-subscribed $store here: Svelte subscribes to those during
  // SSR as well. Explicit client activation keeps server rendering fetch-free.
  onMount(() => {
    mounted = true
    stop = resource.subscribe((value) => { snapshot = value })
    return () => {
      mounted = false
      stop?.()
      stop = undefined
      resource.dispose()
    }
  })

  $effect(() => {
    const requestedRuntime = runtime ?? contextRuntime
    if (!requestedRuntime) throw new Error('MirrorlessQuery requires a runtime')

    if (requestedRuntime !== activeRuntime) {
      stop?.()
      resource.dispose()
      resource = createMirrorlessQuery<T>(requestedRuntime, id, params, options)
      activeRuntime = requestedRuntime
      snapshot = resource.getSnapshot()
      if (mounted) stop = resource.subscribe((value) => { snapshot = value })
    } else {
      resource.setQuery(id, params, options)
      snapshot = resource.getSnapshot()
    }
  })

  // Effects run after rendering. A new term must never render a previous term's
  // data during that gap, even when the old read already has a successful value.
  const current = $derived.by(() => {
    if (activeRuntime !== (runtime ?? contextRuntime) || !snapshotMatches(snapshot, id, params, activeRuntime.equal)) {
      return idleSnapshot(id, params) as QuerySnapshot<T>
    }
    return snapshot
  })
</script>

{#if current.status === 'error' && current.data === undefined}
  {#if error}
    {@render error(current)}
  {:else}
    {throwInitialError(current.error)}
  {/if}
{:else if current.data === undefined}
  {@render loading?.(current)}
{:else}
  {@render children?.(current.data)}
{/if}
