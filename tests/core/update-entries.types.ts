import { createMirrorless, type UpdateEntries } from '../../src/core/index.js'

const broad: UpdateEntries = { Read: true }
const literalFalse: UpdateEntries = { Read: { done: false } }
const predicate: UpdateEntries = { Read: () => false }
void [broad, literalFalse, predicate]

// @ts-expect-error false is not a supported broad update-map flag.
const invalid: UpdateEntries = { Read: false }
void invalid

// @ts-expect-error constructor flags must agree with runtime validation.
createMirrorless({ updates: { Save: { Read: false } } })
