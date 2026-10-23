// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import http from 'node:http'
import { pathToFileURL } from 'node:url'

export const MAX_BODY_BYTES = 16_384
export const INITIAL_TASKS = Object.freeze([
  Object.freeze({ id: '1', title: 'Keep client state local', done: false }),
  Object.freeze({ id: '2', title: 'Let server data flow', done: true }),
])

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function reply(request, response, status, value, headers = {}) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(status >= 400 ? { Connection: 'close' } : {}),
    ...headers,
  })
  response.end(request.method === 'HEAD' ? undefined : body)
}

function readJson(request) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] ?? '')) {
    request.resume()
    return Promise.reject(new HttpError(415, 'Use Content-Type: application/json'))
  }
  if (Number(request.headers['content-length']) > MAX_BODY_BYTES) {
    request.resume()
    return Promise.reject(new HttpError(413, 'JSON body exceeds 16384 bytes'))
  }

  return new Promise((resolve, reject) => {
    const chunks = []
    let length = 0
    let settled = false
    request.on('data', (chunk) => {
      if (settled) return
      length += chunk.length
      if (length > MAX_BODY_BYTES) {
        settled = true
        reject(new HttpError(413, 'JSON body exceeds 16384 bytes'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) return
      settled = true
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('not an object')
        }
        resolve(value)
      } catch {
        reject(new HttpError(400, 'Body must be a JSON object'))
      }
    })
    request.on('error', () => {
      if (!settled) {
        settled = true
        reject(new HttpError(400, 'Unable to read request body'))
      }
    })
    request.on('aborted', () => {
      if (!settled) {
        settled = true
        reject(new HttpError(400, 'Request body was interrupted'))
      }
    })
  })
}

function titleValue(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'title must be a string of 1–200 characters')
  const title = value.trim()
  if (!title || Array.from(title).length > 200) {
    throw new HttpError(400, 'title must be a string of 1–200 characters')
  }
  return title
}

function taskValues(value, create) {
  const keys = Object.keys(value)
  const allowed = create ? ['title'] : ['title', 'done']
  if (!keys.length || keys.some((key) => !allowed.includes(key))) {
    throw new HttpError(400, create ? 'Provide only title' : 'Provide title and/or done')
  }
  const result = {}
  if (Object.hasOwn(value, 'title')) result.title = titleValue(value.title)
  if (create && !Object.hasOwn(value, 'title')) throw new HttpError(400, 'title is required')
  if (Object.hasOwn(value, 'done')) {
    if (typeof value.done !== 'boolean') throw new HttpError(400, 'done must be a boolean')
    result.done = value.done
  }
  return result
}

/** Creates an isolated, not-yet-listening native Node HTTP server. */
export function createTaskServer() {
  const tasks = new Map(INITIAL_TASKS.map((task) => [task.id, { ...task }]))
  let nextId = 3

  const server = http.createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    try {
      const path = new URL(request.url, 'http://127.0.0.1').pathname
      const match = /^\/api\/tasks\/([1-9][0-9]*)$/.exec(path)
      const allowed = path === '/api/tasks'
        ? ['GET', 'POST']
        : path === '/api/summary'
          ? ['GET']
          : match ? ['GET', 'PATCH', 'DELETE'] : undefined
      if (!allowed) throw new HttpError(404, 'Not found')
      if (!allowed.includes(request.method)) {
        reply(request, response, 405, { error: 'Method not allowed' }, { Allow: allowed.join(', ') })
        request.resume()
        return
      }
      if (path === '/api/summary') {
        reply(request, response, 200, { total: tasks.size, done: [...tasks.values()].filter((task) => task.done).length })
      } else if (path === '/api/tasks' && request.method === 'GET') {
        reply(request, response, 200, [...tasks.values()])
      } else if (path === '/api/tasks') {
        const { title } = taskValues(await readJson(request), true)
        const id = String(nextId++)
        tasks.set(id, { id, title, done: false })
        reply(request, response, 201, { id })
      } else {
        const id = match[1]
        if (!tasks.has(id)) throw new HttpError(404, 'Task not found')
        if (request.method === 'GET') {
          reply(request, response, 200, tasks.get(id))
        } else if (request.method === 'PATCH') {
          const values = taskValues(await readJson(request), false)
          // Another request may have deleted this task while its body was arriving.
          const task = tasks.get(id)
          if (!task) throw new HttpError(404, 'Task not found')
          tasks.set(id, { ...task, ...values })
          reply(request, response, 200, { ok: true })
        } else {
          tasks.delete(id)
          reply(request, response, 200, { ok: true })
        }
      }
    } catch (error) {
      request.resume()
      if (!response.headersSent && !response.destroyed) {
        reply(request, response, error.status ?? 500, { error: error.status ? error.message : 'Internal server error' })
      }
    }
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 10_000
  server.keepAliveTimeout = 1000
  return server
}

function portFromEnvironment() {
  const value = process.env.PORT ?? '4000'
  if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error('PORT must be an integer from 0 to 65535')
  return Number(value)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const server = createTaskServer()
    server.on('error', (error) => {
      console.error(`Unable to start task API: ${error.message}`)
      process.exitCode = 1
    })
    server.listen(portFromEnvironment(), '127.0.0.1', () => {
      console.log(`Mirrorless Node task API: http://127.0.0.1:${server.address().port}`)
    })
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      const timer = setTimeout(() => {
        server.closeAllConnections()
        process.exitCode = 1
      }, 2000)
      timer.unref()
      server.close(() => clearTimeout(timer))
      server.closeIdleConnections()
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
