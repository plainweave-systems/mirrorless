export function freezingReviver(_key, value) {
  if (value && typeof value === 'object') Object.freeze(value)
  return value
}

export function parseFrozenJson(text) {
  return JSON.parse(text, freezingReviver)
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen)
  // A frozen parent can still contain unfrozen children, so traversal comes first.
  if (!Object.isFrozen(value)) Object.freeze(value)
  return value
}

export function cloneJson(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

export function cloneFrozenJson(value) {
  return deepFreeze(cloneJson(value))
}
