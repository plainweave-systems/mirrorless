// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import { bindQuery } from 'mirrorless/dom'
import { createHttpRuntime } from './runtime.js'

const runtime = createHttpRuntime()
const tasksRoot = document.querySelector('#tasks')
const summaryRoot = document.querySelector('#summary')
const pendingRoot = document.querySelector('#pending')
const errorRoot = document.querySelector('#error')
const form = document.querySelector('#create-task')
const titleInput = document.querySelector('#title')
const refreshButton = document.querySelector('#refresh')
let pending = false
let disposed = false

const tasksBinding = bindQuery({
  runtime,
  id: '/api/tasks',
  loading: () => { tasksRoot.textContent = 'Loading tasks…' },
  error: ({ error }) => { tasksRoot.textContent = error.message },
  render(tasks) {
    if (!tasks.length) {
      tasksRoot.textContent = 'No tasks yet.'
      return
    }
    const list = document.createElement('ul')
    for (const task of tasks) {
      const row = document.createElement('li')
      row.textContent = `${task.done ? 'Complete' : 'Not complete'}: ${task.title}`
      list.append(row)
    }
    tasksRoot.replaceChildren(list)
  },
})

const summaryBinding = bindQuery({
  runtime,
  id: '/api/summary',
  loading: () => { summaryRoot.textContent = 'Loading summary…' },
  error: ({ error }) => { summaryRoot.textContent = error.message },
  render(summary) { summaryRoot.textContent = `${summary.done} of ${summary.total} complete` },
})

function setPending(value) {
  pending = value
  pendingRoot.textContent = value ? 'Waiting for the server…' : ''
  for (const button of document.querySelectorAll('button')) button.disabled = value
  titleInput.disabled = value
}

async function perform(url, body) {
  if (pending || disposed) return false
  errorRoot.textContent = ''
  setPending(true)
  try {
    // The receipt is not a list: update rules refetch the interested URLs.
    await runtime.command(url, body)
    return !disposed
  } catch (error) {
    if (!disposed) errorRoot.textContent = error instanceof Error ? error.message : String(error)
    return false
  } finally {
    if (!disposed) setPending(false)
  }
}

async function submit(event) {
  event.preventDefault()
  const title = titleInput.value.trim()
  if (title && await perform('/api/tasks', { title })) titleInput.value = ''
}

function refresh() { void perform('refresh') }
function pagehide(event) { if (!event.persisted) dispose() }

function dispose() {
  if (disposed) return
  disposed = true
  form.removeEventListener('submit', submit)
  refreshButton.removeEventListener('click', refresh)
  window.removeEventListener('pagehide', pagehide)
  tasksBinding.dispose()
  summaryBinding.dispose()
  runtime.dispose()
}

form.addEventListener('submit', submit)
refreshButton.addEventListener('click', refresh)
window.addEventListener('pagehide', pagehide)
if (import.meta.hot) import.meta.hot.dispose(dispose)
