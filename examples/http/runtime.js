// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import { createMirrorless } from 'mirrorless'

export function createHttpRuntime({ fetch: fetchOperation = globalThis.fetch, unsubscribeDelayMs = 120_000 } = {}) {
  if (typeof fetchOperation !== 'function') throw new TypeError('A fetch implementation is required')

  async function jsonResponse(response) {
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const error = new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
      error.status = response.status
      throw error
    }
    return response.status === 204 ? null : response.json()
  }

  return createMirrorless({
    unsubscribeDelayMs,
    query(url, _params, { signal }) {
      return fetchOperation(url, { method: 'GET', signal }).then(jsonResponse)
    },
    command(url, body, { signal }) {
      return fetchOperation(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      }).then(jsonResponse)
    },
    updates: {
      '/api/tasks': ['/api/tasks', '/api/summary'],
      refresh: ['/api/tasks', '/api/summary'],
    },
    virtualCommands: ['refresh'],
  })
}
