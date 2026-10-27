# Connect the API you already have

Mirrorless does not require a bespoke backend, a server plugin, or a particular wire format. It needs two application dispatchers:

```js
createMirrorless({
  query: async (name, params, context) => { /* return a read answer */ },
  command: async (name, params, context) => { /* confirm a command */ },
  updates: { /* known consequences */ },
})
```

A read name can already be its GET URL, and a command name can already be its POST URL. No operation-name routing table is required. The dispatchers supply your transport policy and turn transport or application-level failures into rejected promises; they only need to translate names when your API actually benefits from that.

A read can be an existing REST resource, a GraphQL operation, an RPC call, or a composite application read. A command can return an acknowledgement rather than the next version of every affected read.

## REST: use URLs directly

A small JSON helper can handle HTTP status consistently:

```js
async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  const body = response.status === 204 ? null : await response.json()
  if (!response.ok) {
    const error = new Error(`Request failed with HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return body
}
```

This example expects JSON for responses other than `204`. Adapt parsing to your service's contract rather than treating every successful response as JSON.

Use each URL directly as the operation name:

```js
import { createMirrorless } from 'mirrorless'

const runtime = createMirrorless({
  query: (url, _params, { signal }) => jsonRequest(url, { signal }),
  command: (url, body, { signal }) => jsonRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  }),
  updates: {
    '/api/tasks': ['/api/tasks', '/api/summary'],
  },
})

await runtime.command('/api/tasks', { title: 'Review proposal' })
```

A component declares the actual GET URL:

```jsx
<MirrorlessQuery id="/api/tasks">
  {(tasks) => <TaskList tasks={tasks} />}
</MirrorlessQuery>
```

The command is an ordinary `POST /api/tasks`, whose receipt can be just `{ id }`. Its update rule reruns interested `GET /api/tasks` and `GET /api/summary` requests. Query and command dispatch are separate, so GET and POST can use the same URL without inventing aliases such as `GetTasks` and `CreateTask`.

The runnable [raw-URL demo](../examples/http/README.md) uses this approach with the existing task servers and no server changes.

### URL identity and HTTP methods

Put path parameters and query strings in the URL itself, for example `/api/tasks/1` or `/api/tasks?status=active`. In this example the query dispatcher does not serialize the separate `params` argument; the URL already contains the request parameters. Use consistent URLs for equivalent reads so subscribers can share a run.

Mirrorless treats those strings as exact read identities. It does **not** infer route patterns, strip query strings, or group every `/api/tasks/...` read under `/api/tasks`. Include each affected URL in the update rules; an unlisted filtered URL will not refresh just because a similarly named collection URL does.

This minimal transport deliberately chooses GET for reads and POST for commands. For PATCH/DELETE, your generic command function can accept a method along with the body, or your existing API client can keep handling those methods. If different commands share a URL, make their update rules cover the effects of each, or distinguish them with parameter patterns or method-qualified command names. None of this requires a per-endpoint switch.

### Optional: named operations

Names can be useful when they are already part of your API or when one application read composes several endpoints. The fuller framework demos use this alternative, not a required REST routing layer:


```js
function query(name, params) {
  switch (name) {
    case 'GetTasks':
      return jsonRequest('/api/tasks')
    case 'GetTask':
      return jsonRequest(`/api/tasks/${encodeURIComponent(params.id)}`)
    case 'GetSummary':
      return jsonRequest('/api/summary')
    default:
      throw new Error(`Unknown read: ${name}`)
  }
}

function command(name, params) {
  switch (name) {
    case 'CreateTask':
      return jsonRequest('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: params.title }),
      })
    case 'UpdateTask': {
      const { id, ...changes } = params
      return jsonRequest(`/api/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
    }
    case 'DeleteTask':
      return jsonRequest(`/api/tasks/${encodeURIComponent(params.id)}`, {
        method: 'DELETE',
      })
    default:
      throw new Error(`Unknown command: ${name}`)
  }
}
```

Use whichever identity already makes the application clearest: raw URLs for ordinary HTTP resources, existing operation names for a domain API, or explicit names for composite reads. There is no requirement to rename REST resources before they can be consumed.

## GraphQL

A GraphQL transport must decide what counts as success. An HTTP `200` response can contain GraphQL errors. If a failed command resolves normally, Mirrorless has no way to know that the intended write failed.

The following application factory accepts your existing table of GraphQL documents. It does not define or require a GraphQL schema:

```js
import { createMirrorless } from 'mirrorless'

export function createGraphqlRuntime({ endpoint, documents, updates }) {
  async function execute(name, variables) {
    const document = documents[name]
    if (!document) throw new Error(`Unknown GraphQL operation: ${name}`)

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: name,
        query: document,
        variables,
      }),
    })
    if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`)

    const result = await response.json()
    if (result.errors?.length) {
      // This integration rejects partial results. Choose that policy explicitly.
      throw new Error('The GraphQL operation was not confirmed')
    }
    return result.data
  }

  return createMirrorless({ query: execute, command: execute, updates })
}
```

The names in the update rules can match GraphQL operation names directly. A frontend-only tag taxonomy is not required. Alternatively, an application-level read can compose several GraphQL operations behind one name.

If your API intentionally returns useful partial results alongside errors, design that policy at the dispatcher/selector boundary and make the resulting read shape explicit. Do not accidentally treat a rejected write as a successful command merely because some response data was present.

## RPC and existing clients

An existing typed client can remain responsible for serialization, authentication, signing, endpoint resolution, and protocol errors. A Mirrorless dispatcher can delegate to it. There is no need for the runtime to learn those concerns.

The dispatcher signatures are general on purpose. You can route operations through one existing name-based client, a switch over a small API, or application-level dispatch tables. Mirrorless does not require a different wrapper function for every operation, but it does not prohibit useful domain helpers either.

Do not expose an unrestricted remote execution interface just to make names line up. The API should keep its normal authorization and validation boundaries.

## Composite reads

Sometimes the component needs a read representation that does not correspond to one endpoint. The query dispatcher can obtain several answers and return one application value.

Make the resulting dependency rule reflect all the commands that can affect that value. Naming the composite read is not enough to infer those relationships.

Composite reads also inherit their sources' consistency limitations. Several successful requests do not automatically form one atomic snapshot. If an invariant depends on that guarantee, obtain the representation from an API that can provide it transactionally.

## Response envelopes and selectors

A transport may return an envelope with protocol metadata rather than the exact component input. Mirrorless's default data selection is identity. Use `selectData` when the runtime should retain a response but deliver a selected value:

```js
const runtime = createMirrorless({
  query: queryWithEnvelope,
  command: commandWithEnvelope,
  selectData: (response) => response.data,
  updates,
})
```

The dispatcher is still responsible for rejecting failures. A selector that turns an error envelope into `undefined` does not provide meaningful error handling; it can leave the boundary without a renderable first value.

## Authentication and cancellation

Create dispatchers for the runtime's user/session scope. Keep credentials out of read parameters and operation names. Those parameters can appear in snapshots, diagnostics, or application logs.

Where the dispatcher context provides an abort signal, pass it to transports that support cancellation. Cancellation is a cooperative resource-management mechanism, not proof that a server write did not execute. An API may commit a command even if the client disconnects before receiving its acknowledgement.

Replace and dispose the runtime when identity or authorization scope changes. See [security and runtime lifetime](security.md).

## CORS and development proxies

Mirrorless does not bypass browser security rules. An API must be callable from the browser under its normal CORS, cookie, and credential policy, or through an appropriate application-controlled backend/proxy.

The examples' Vite proxy is a local development convenience. It is not a production authentication boundary, an authorization mechanism, or a replacement for the upstream API's security model.
