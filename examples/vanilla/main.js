// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import { bindQuery } from 'mirrorless/dom'
import { createTaskRuntime, startLiveRefresh } from '../shared/task-api.js'
import '../shared/style.css'

const runtime = createTaskRuntime()
const tasksRoot = document.querySelector('#tasks')
const summaryRoot = document.querySelector('#summary')
const detailRoot = document.querySelector('#detail')
const errorRoot = document.querySelector('#error')
const pendingRoot = document.querySelector('#pending')
const form = document.querySelector('#create-task')
const titleInput = document.querySelector('#title')
const liveInput = document.querySelector('#live')
const refreshButton = document.querySelector('#refresh')
let pending = false
let selectedId
let detailBinding
let stopLive

function setPending(value) {
  pending = value
  pendingRoot.textContent = value ? 'Waiting for the server…' : ''
  for (const button of document.querySelectorAll('button')) button.disabled = value
}

async function perform(name, params = {}) {
  if (pending) return false
  errorRoot.textContent = ''
  setPending(true)
  try {
    // No array updates here. Successful commands cause interested reads to run again.
    await runtime.command(name, params)
    return true
  } catch (error) {
    errorRoot.textContent = error instanceof Error ? error.message : String(error)
    return false
  } finally {
    setPending(false)
  }
}

function button(label, action) {
  const element = document.createElement('button')
  element.type = 'button'
  element.textContent = label
  element.disabled = pending
  element.addEventListener('click', action)
  return element
}

function selectTask(id) {
  selectedId = id
  if (detailBinding) {
    detailBinding.setQuery('GetTask', { id })
    return
  }
  detailBinding = bindQuery({
    runtime,
    id: 'GetTask',
    params: { id },
    loading: () => { detailRoot.textContent = 'Loading task…' },
    error: ({ error }) => { detailRoot.textContent = error.message },
    render(task) {
      const title = document.createElement('p')
      title.textContent = task.title
      const status = document.createElement('p')
      status.textContent = task.done ? 'Complete' : 'Not complete'
      detailRoot.replaceChildren(title, status)
    },
  })
}

const tasksBinding = bindQuery({
  runtime,
  id: 'GetTasks',
  loading: () => { tasksRoot.textContent = 'Loading tasks…' },
  error: ({ error }) => { tasksRoot.textContent = error.message },
  render(tasks) {
    const list = document.createElement('ul')
    for (const task of tasks) {
      const row = document.createElement('li')
      const label = document.createElement('span')
      label.textContent = `${task.done ? '✓' : '○'} ${task.title} `
      row.append(
        label,
        button('Details', () => selectTask(task.id)),
        document.createTextNode(' '),
        button(task.done ? 'Reopen' : 'Complete', () => perform('UpdateTask', { id: task.id, done: !task.done })),
      )
      list.append(row)
    }
    if (!tasks.length) {
      tasksRoot.textContent = 'No tasks yet.'
    } else {
      tasksRoot.replaceChildren(list)
    }
    // Selection is local. The selected task's actual fields belong to its read.
    if (selectedId && !tasks.some(task => task.id === selectedId)) {
      selectedId = undefined
      detailBinding?.dispose()
      detailBinding = undefined
      detailRoot.textContent = 'Select a task to declare another read.'
    }
  },
})

const summaryBinding = bindQuery({
  runtime,
  id: 'GetSummary',
  loading: () => { summaryRoot.textContent = 'Loading summary…' },
  error: ({ error }) => { summaryRoot.textContent = error.message },
  render(summary) { summaryRoot.textContent = `${summary.done} of ${summary.total} complete` },
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const title = titleInput.value.trim()
  if (title && await perform('CreateTask', { title })) titleInput.value = ''
})
refreshButton.addEventListener('click', () => perform('RefreshTasks'))
liveInput.addEventListener('change', () => {
  stopLive?.()
  stopLive = liveInput.checked ? startLiveRefresh(runtime) : undefined
})

function dispose() {
  stopLive?.()
  tasksBinding.dispose()
  summaryBinding.dispose()
  detailBinding?.dispose()
  runtime.dispose()
}
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose() })
if (import.meta.hot) import.meta.hot.dispose(dispose)
