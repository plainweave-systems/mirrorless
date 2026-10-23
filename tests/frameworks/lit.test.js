// @vitest-environment jsdom
// Copyright 2026 Plainweave Systems. SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LitElement, html } from 'lit'
import { createMirrorless } from '../../src/core/index.js'
import { MirrorlessController } from '../../src/lit/index.js'

let elementId = 0
const runtimes = new Set()

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function settle(element) {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
  await element.updateComplete
}

function runtimeFor(options) {
  const runtime = createMirrorless({ unsubscribeDelayMs: 0, ...options })
  runtimes.add(runtime)
  return runtime
}

function makeElement(runtime, { id = 'Read', params = {} } = {}) {
  class ReadElement extends LitElement {
    query = new MirrorlessController(this, { runtime, id, params })
    render() {
      const snapshot = this.query.snapshot
      if (snapshot.data === undefined) {
        if (snapshot.status === 'error') return html`<p role="alert">${snapshot.error instanceof Error ? snapshot.error.message : String(snapshot.error)}</p>`
        return html`<p role="status">Loading</p>`
      }
      return html`<output>${JSON.stringify(snapshot.data)}</output>`
    }
  }
  const name = `mirrorless-lit-test-${++elementId}`
  customElements.define(name, ReadElement)
  return document.createElement(name)
}

afterEach(() => {
  document.body.replaceChildren()
  for (const runtime of runtimes) runtime.dispose()
  runtimes.clear()
})

describe('Lit ReactiveController integration', () => {
  it('starts only on connection and renders server data through Lit', async () => {
    const pending = deferred()
    const query = vi.fn(() => pending.promise)
    const runtime = runtimeFor({ query })
    const element = makeElement(runtime)
    expect(query).not.toHaveBeenCalled()
    document.body.append(element)
    await element.updateComplete
    expect(element.shadowRoot.querySelector('[role="status"]')?.textContent).toBe('Loading')
    const response = { title: '<not markup>' }
    pending.resolve(response)
    await settle(element)
    expect(element.query.data).toBe(response)
    expect(element.shadowRoot.querySelector('output')?.textContent).toContain('<not markup>')
    expect(element.shadowRoot.querySelector('not-markup')).toBeNull()
  })

  it.each([null, false, 0, '', []])('renders valid falsy/empty data %j', async (value) => {
    const runtime = runtimeFor({ query: async () => value })
    const element = makeElement(runtime)
    document.body.append(element)
    await settle(element)
    expect(element.shadowRoot.querySelector('output')?.textContent).toBe(JSON.stringify(value))
    expect(element.shadowRoot.querySelector('[role="status"]')).toBeNull()
  })

  it('shares one core read between independent Lit elements', async () => {
    const pending = deferred()
    const query = vi.fn(() => pending.promise)
    const runtime = runtimeFor({ query })
    const first = makeElement(runtime, { params: { id: 1 } })
    const second = makeElement(runtime, { params: { id: 1 } })
    document.body.append(first, second)
    await Promise.resolve()
    expect(query).toHaveBeenCalledTimes(1)
    const response = { id: 1 }
    pending.resolve(response)
    await Promise.all([settle(first), settle(second)])
    expect(first.query.data).toBe(response)
    expect(second.query.data).toBe(response)
    expect(first.shadowRoot.querySelector('output')?.textContent).toBe('{"id":1}')
    expect(second.shadowRoot.querySelector('output')?.textContent).toBe('{"id":1}')
  })

  it('switches parameters without rendering the old term or accepting late old results', async () => {
    const one = deferred(), two = deferred()
    const runtime = runtimeFor({ query: (_name, params) => params.id === 1 ? one.promise : two.promise })
    const element = makeElement(runtime, { params: { id: 1 } })
    document.body.append(element)
    await element.updateComplete
    element.query.setQuery('Read', { id: 2 })
    expect(element.query.data).toBeUndefined()
    expect(element.query.snapshot.params.id).toBe(2)
    await element.updateComplete
    one.resolve({ id: 1 })
    await settle(element)
    expect(element.shadowRoot.querySelector('output')).toBeNull()
    two.resolve({ id: 2 })
    await settle(element)
    expect(element.shadowRoot.querySelector('output')?.textContent).toBe('{"id":2}')
  })

  it('keeps confirmed data visible during virtual-command refreshes', async () => {
    const next = deferred()
    let reads = 0
    const runtime = runtimeFor({
      query: async () => ++reads === 1 ? { value: 'first' } : next.promise,
      virtualCommands: ['Refresh'], updates: { Refresh: ['Read'] },
    })
    const element = makeElement(runtime)
    document.body.append(element)
    await settle(element)
    const refreshing = runtime.command('Refresh')
    await settle(element)
    expect(element.shadowRoot.querySelector('output')?.textContent).toContain('first')
    expect(element.shadowRoot.querySelector('[role="status"]')).toBeNull()
    next.resolve({ value: 'second' })
    await refreshing
    await settle(element)
    expect(element.shadowRoot.querySelector('output')?.textContent).toContain('second')
  })

  it('makes initial errors available for local safe rendering and explicit retries', async () => {
    let reads = 0
    const runtime = runtimeFor({ query: async () => { if (++reads === 1) throw new Error('Offline'); return 'online' } })
    const element = makeElement(runtime)
    document.body.append(element)
    await settle(element)
    expect(element.shadowRoot.querySelector('[role="alert"]')?.textContent).toBe('Offline')
    await element.query.refetch()
    await settle(element)
    expect(element.shadowRoot.querySelector('output')?.textContent).toBe('"online"')
  })

  it.each([undefined, null, false, 0, ''])('renders first-read failure for falsy rejection reason %j', async (reason) => {
    const runtime = runtimeFor({ query: async () => { throw reason } })
    const element = makeElement(runtime)
    document.body.append(element)
    await settle(element)
    expect(element.query.snapshot.status).toBe('error')
    expect(element.query.snapshot.error).toBe(reason)
    expect(element.shadowRoot.querySelector('[role="alert"]')?.textContent).toBe(String(reason))
    expect(element.shadowRoot.querySelector('[role="status"]')).toBeNull()
  })

  it('does not notify a disconnected host, then catches up on reconnect', async () => {
    let current = 'first'
    const query = vi.fn(async () => current)
    const runtime = runtimeFor({
      query, unsubscribeDelayMs: 1000,
      virtualCommands: ['Refresh'], updates: { Refresh: ['Read'] },
    })
    const element = makeElement(runtime)
    document.body.append(element)
    await settle(element)
    element.remove()
    const requestUpdate = vi.spyOn(element, 'requestUpdate')
    current = 'second'
    await runtime.command('Refresh')
    expect(requestUpdate).not.toHaveBeenCalled()
    expect(element.query.data).toBe('first')
    document.body.append(element)
    await settle(element)
    expect(element.query.data).toBe('second')
    expect(element.shadowRoot.querySelector('output')?.textContent).toBe('"second"')
    expect(query).toHaveBeenCalledTimes(2)
  })
})
