import { sameValue } from './equality.js'
import { deepFreeze } from './frozenJson.js'

export function clonePattern(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  const result = Array.isArray(value) ? [] : {}
  seen.set(value, result)
  for (const key of Object.keys(value)) {
    Object.defineProperty(result, key, {
      value: clonePattern(value[key], seen), enumerable: true, configurable: true, writable: true,
    })
  }
  return result
}

export function normalizeOperationTerm(term) {
  const operationName = typeof term === 'string' ? term : Array.isArray(term) ? term[0] : undefined
  if (typeof operationName !== 'string' || !operationName) {
    throw new TypeError(`Invalid operation term name: ${String(operationName)}`)
  }
  if (typeof term === 'string') {
    return Object.freeze({ operationName, paramsPattern: Object.freeze({}) })
  }
  if (!Array.isArray(term) || term.length < 1 || term.length > 2) {
    throw new TypeError(`Invalid operation term: ${String(term)}`)
  }
  const paramsPattern = term[1] === undefined ? {} : term[1]
  if (paramsPattern === null || typeof paramsPattern !== 'object' || Array.isArray(paramsPattern)) {
    throw new TypeError(`Invalid params pattern for operation term ${operationName}`)
  }
  return Object.freeze({ operationName, paramsPattern: deepFreeze(clonePattern(paramsPattern)) })
}

export function symbolBindingKey(symbol) {
  if (typeof symbol !== 'symbol') return undefined
  return Symbol.keyFor(symbol) ?? symbol.description
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key)
}

export function resolvePatternValue(patternValue, sourceParams = {}) {
  if (typeof patternValue !== 'symbol') return { found: true, value: patternValue }
  const key = symbolBindingKey(patternValue)
  if (!key || !hasOwn(sourceParams, key)) return { found: false, value: undefined }
  return { found: true, value: sourceParams[key] }
}

export function paramsMatchPattern(targetParams = {}, paramsPattern = {}, sourceParams = {}, equal = sameValue) {
  for (const [key, patternValue] of Object.entries(paramsPattern ?? {})) {
    if (!hasOwn(targetParams, key)) return false
    const resolved = resolvePatternValue(patternValue, sourceParams)
    if (!resolved.found || !equal(targetParams[key], resolved.value)) return false
  }
  return true
}

export function operationMatchesTerm(operationName, params, term, sourceParams = {}, equal = sameValue) {
  const normalized = normalizeOperationTerm(term)
  return operationName === normalized.operationName &&
    paramsMatchPattern(params, normalized.paramsPattern, sourceParams, equal)
}
