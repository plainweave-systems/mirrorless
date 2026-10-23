// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import { getContext, setContext } from 'svelte'

export const MIRRORLESS_CONTEXT = Symbol.for('mirrorless.svelte.runtime')

/** Call during component initialization. Runtime ownership remains with the app. */
export function provideMirrorless(runtime) {
  if (!runtime || typeof runtime.observe !== 'function') {
    throw new TypeError('provideMirrorless requires a Mirrorless runtime')
  }
  setContext(MIRRORLESS_CONTEXT, runtime)
  return runtime
}

/** Call during component initialization, beneath a matching provider. */
export function useMirrorlessRuntime() {
  const runtime = getContext(MIRRORLESS_CONTEXT)
  if (!runtime) {
    throw new Error('No Mirrorless runtime in Svelte context; call provideMirrorless(runtime) in an ancestor')
  }
  return runtime
}
