# Local state, forms, and pending commands

Mirrorless removes the need for an application-owned model of server entities. It does not remove the frontend's own state.

A useful test is: **does this value describe a confirmed server answer, or this client's current interaction?**

| Value | Responsibility |
| --- | --- |
| Tasks returned by `GetTasks` | Delivered server data |
| Summary returned by `GetSummary` | Delivered server data |
| Selected task ID | Local interaction state |
| Text not yet submitted | Local draft state |
| Whether a dialog is open | Local interaction state |
| Whether this form's command is pending | Local interaction state |
| A validation message for this form | Local interaction state |

A selected ID is not a second copy of a task. A draft based on a task's title is not a replacement for the confirmed title. Give those things explicit names and separate lifetimes.

## A form edits a draft, not the read response

A React editing session can look like this:

```jsx
import { useState } from 'react'
import { useMirrorlessRuntime } from 'mirrorless/react'

export function TaskEditor({ task, onClose }) {
  const runtime = useMirrorlessRuntime()
  const [draftTitle, setDraftTitle] = useState(task.title)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  async function save(event) {
    event.preventDefault()
    if (pending) return
    const title = draftTitle.trim()
    if (!title) {
      setMessage('Enter a title.')
      return
    }

    setPending(true)
    setMessage('')
    try {
      await runtime.command('UpdateTask', { id: task.id, title })
      onClose()
    } catch (error) {
      setMessage('The change was not confirmed. Your draft is still here.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={save}>
      <label>
        Title
        <input
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          disabled={pending}
        />
      </label>
      <button disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
      <button type="button" onClick={onClose} disabled={pending}>Cancel</button>
      {message && <p role="status">{message}</p>}
    </form>
  )
}
```

Open a new editor instance for a new editing session, for example by mounting it conditionally and using the task ID as a key when selection changes. Decide explicitly whether reopening an editor should preserve an old draft or initialize a new one.

There is no assignment to `task.title`, no update to a fetched task array, and no manually adjusted summary. After the command succeeds, configured reads obtain the confirmed representations.

The same distinction applies to Vue refs, Svelte local state, Solid signals, Angular signals, Lit fields, and ordinary DOM input values. A framework's local-state primitive is not the problem. Treating it as the maintained world model of the server is the problem Mirrorless avoids.

## Do not overwrite a draft on every refresh

The server's task may change while the editor is open. Blindly copying every new `task.title` into `draftTitle` can erase what the user is typing.

Choose an interaction policy:

- Keep the draft until the user saves or cancels.
- Warn that the server value changed and offer to reload it.
- Show both values and ask the user to reconcile them.
- Use an API version or conditional write when conflicting edits must be rejected.

Mirrorless cannot choose the right policy for every form. A refresh delivers a new server answer; it does not grant permission to replace local intent.

## Pending is honest; optimistic confirmation is not required

A user can see that a command is in progress without the UI pretending the server has accepted it.

Examples include disabling the submitting button, showing a spinner on the affected row, keeping an explicit pending badge, or displaying a separate provisional item. If you show provisional content, label and store it as provisional interaction state rather than merging it into the confirmed read response.

Mirrorless does not automatically patch confirmed data optimistically. This avoids requiring rollback logic for its delivered values. It does not prevent the application from designing a responsive interaction.

## Keep command errors distinct from read errors

A command can fail before confirmation. A later read can also fail after the command succeeded. Those are different facts.

The dispatcher must reject failed commands. The submitting interaction can then preserve its draft and show a retry or recovery path. Query snapshots report read failures; an existing read value can remain visible during a refresh failure.

Do not tell the user "nothing changed" merely because a refresh failed. Do not tell the user "try again" after an ambiguous network timeout without considering whether the server may already have committed the operation. For consequential writes, use the API's idempotency or status-checking mechanisms.

## Avoid accidental duplicate commands

Mirrorless does not automatically retry writes, but application handlers can still submit twice. Disable or guard the submitting interaction while it is pending. If two different controls can issue the same operation, their local guards do not constitute global exactly-once execution.

Exactly-once effects require an appropriate server contract. A client-side pending flag is an interaction affordance, not a transaction protocol.

## Derive display values without creating another model

It is reasonable to format a returned amount, group a delivered list for rendering, or compute a label from current input data. It becomes a different responsibility when the application starts retaining and incrementally patching those results as its authoritative picture of the server.

Prefer derived display work that is recomputed from delivered values. For expensive analysis or specialized projections, decide explicitly whether a separate projection is warranted and how complete it is. Do not make every ordinary component pay that architectural cost by default.
