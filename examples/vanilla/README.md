# Vanilla JavaScript

From the Mirrorless repository root:

```sh
npm install
npm run demo:server
# In another terminal:
npm run demo:vanilla
```

Open the URL printed by Vite. The `/api` proxy targets the local demo server at
`127.0.0.1:4000`. The Python or Go server can replace the Node server without
changing the client.

The task list, selected task, and summary declare independent read interests.
Creating or completing a task sends a command; the update rules refresh those
interests. No command handler patches a task array or calculates a replacement
summary. The server returns only a receipt for commands.

The input draft, selected ID, live-refresh checkbox, and pending indicator are
local state. `bindQuery` delivers plain data into safe DOM rendering functions.
The example uses `textContent` rather than interpolating server values into HTML.

Enable the timer in two windows to observe changes made by another client. The
timer emits a virtual `RefreshTasks` command; it does not maintain a second task
model. Disable it to stop periodic reads.

```sh
npm run build --workspace examples/vanilla
```
