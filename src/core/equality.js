function enumerableKeys(value) {
  return [
    ...Object.keys(value),
    ...Object.getOwnPropertySymbols(value).filter((key) => Object.prototype.propertyIsEnumerable.call(value, key)),
  ]
}

// Value comparison for JSON-shaped parameters and patterns. Unsupported host objects
// only compare equal by reference; two different Maps must not accidentally equal {}.
function deepEqual(a, b, seen = new WeakMap(), reverseSeen = new WeakMap()) {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  const tag = Object.prototype.toString.call(a)
  if (tag !== Object.prototype.toString.call(b)) return false
  if (tag === '[object Date]') return Object.is(a.getTime(), b.getTime())
  if (tag === '[object RegExp]') return String(a) === String(b)
  if (tag !== '[object Object]' && tag !== '[object Array]') return false
  if (seen.has(a) || reverseSeen.has(b)) {
    return seen.get(a) === b && reverseSeen.get(b) === a
  }
  seen.set(a, b)
  reverseSeen.set(b, a)
  try {
    if (Array.isArray(a) && a.length !== b.length) return false
    const aKeys = enumerableKeys(a)
    const bKeys = enumerableKeys(b)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) => (
      Object.prototype.propertyIsEnumerable.call(b, key) && deepEqual(a[key], b[key], seen, reverseSeen)
    ))
  } finally {
    // Track cycles on the active path, not reference sharing between siblings:
    // repeated objects and their independently cloned JSON values are equal.
    seen.delete(a)
    reverseSeen.delete(b)
  }
}

export function sameParams(a, b) {
  return deepEqual(a ?? {}, b ?? {})
}

export function sameValue(a, b) {
  return deepEqual(a, b)
}
