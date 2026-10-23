// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import { cloneFrozenJson, sameParams } from 'mirrorless'

/** A display-only snapshot for a term whose observer has not been switched yet. */
export function idleSnapshot(id, params = {}) {
  return Object.freeze({
    id,
    operationName: id,
    params: cloneFrozenJson(params ?? {}),
    status: 'idle',
    loading: false,
    ready: false,
    data: undefined,
    response: undefined,
    error: undefined,
    lastFetchedAt: undefined,
    fetchStartedAt: undefined,
  })
}

export function snapshotMatches(snapshot, id, params, equal = sameParams) {
  // Compare the same transportable term that core observes: JSON drops optional
  // undefined object properties and converts undefined array entries to null.
  return snapshot.operationName === id && equal(snapshot.params, cloneFrozenJson(params ?? {}))
}

export function throwInitialError(error) {
  throw error
}
