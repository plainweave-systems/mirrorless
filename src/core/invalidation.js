import { sameValue } from './equality.js'
import { normalizeOperationTerm, paramsMatchPattern } from './operationTerms.js'

function isTermTuple(value) {
  return Array.isArray(value) && typeof value[0] === 'string' &&
    (value.length === 1 || (value.length === 2 &&
      (value[1] === undefined || (value[1] !== null && typeof value[1] === 'object' && !Array.isArray(value[1])))))
}

function normalizeTarget(term, direction, predicate) {
  const { operationName, paramsPattern } = normalizeOperationTerm(term)
  return Object.freeze({
    [direction === 'forward' ? 'queryName' : 'commandName']: operationName,
    operationName,
    paramsPattern,
    predicate,
    term: typeof term === 'string' ? term : Object.freeze([operationName, paramsPattern]),
  })
}

function normalizeTargets(entries, direction) {
  if (typeof entries === 'string' || isTermTuple(entries)) return [normalizeTarget(entries, direction)]
  if (Array.isArray(entries)) return entries.map((term) => normalizeTarget(term, direction))
  if (entries === null || typeof entries !== 'object') {
    throw new TypeError('Update entries must be an operation term, a list of terms, or a target map')
  }
  return Object.entries(entries).map(([name, value]) => {
    if (value === true || value === undefined || value === null) return normalizeTarget(name, direction)
    if (typeof value === 'function') return normalizeTarget(name, direction, value)
    return normalizeTarget([name, value], direction)
  })
}

function normalizeMap(map, direction) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new TypeError('Update maps must be objects')
  const result = Object.create(null)
  for (const [name, entries] of Object.entries(map)) {
    if (!name) throw new TypeError('Update map operation names must not be empty')
    result[name] = Object.freeze(normalizeTargets(entries, direction))
  }
  return Object.freeze(result)
}

/** Name-only inverse for inspecting/auditing operation edges; it does not invert parameter predicates. */
export function reverseUpdateMap(updates = {}) {
  const result = Object.create(null)
  const forward = normalizeMap(updates, 'forward')
  for (const [commandName, targets] of Object.entries(forward)) {
    for (const { queryName } of targets) {
      result[queryName] ??= []
      if (!result[queryName].includes(commandName)) result[queryName].push(commandName)
    }
  }
  return result
}

export function normalizeUpdateMaps(options = {}) {
  const rawForward = options.updates ?? options.mutationInvalidatesQueries ?? {}
  const explicitReverse = options.updatedBy ?? options.queryInvalidatedByMutations
  const updates = normalizeMap(rawForward, 'forward')
  const updatedBy = normalizeMap(explicitReverse ?? reverseUpdateMap(rawForward), 'reverse')
  return Object.freeze({
    updates,
    updatedBy,
    mutationInvalidatesQueries: updates,
    queryInvalidatedByMutations: updatedBy,
  })
}

/** Audits operation names/edge presence, not logical equivalence of parameter patterns. */
export function validateUpdateMaps(options = {}) {
  const errors = []
  let maps
  try {
    maps = normalizeUpdateMaps(options)
  } catch (error) {
    return [error.message]
  }
  const knownCommands = options.knownCommands ?? options.knownMutations
  for (const [commandName, targets] of Object.entries(maps.updates)) {
    if (knownCommands && !knownCommands.has(commandName)) errors.push(`Unknown command in updates: ${commandName}`)
    for (const { queryName } of targets) {
      if (options.knownQueries && !options.knownQueries.has(queryName)) errors.push(`Unknown query in updates.${commandName}: ${queryName}`)
      if (!maps.updatedBy[queryName]?.some((target) => target.commandName === commandName)) {
        errors.push(`Missing reverse update edge: ${queryName} <- ${commandName}`)
      }
    }
  }
  for (const [queryName, targets] of Object.entries(maps.updatedBy)) {
    if (options.knownQueries && !options.knownQueries.has(queryName)) errors.push(`Unknown query in updatedBy: ${queryName}`)
    for (const { commandName } of targets) {
      if (knownCommands && !knownCommands.has(commandName)) errors.push(`Unknown command in updatedBy.${queryName}: ${commandName}`)
      if (!maps.updates[commandName]?.some((target) => target.queryName === queryName)) {
        errors.push(`Missing forward update edge: ${commandName} -> ${queryName}`)
      }
    }
  }
  return [...new Set(errors)]
}

export function updateTargetsForCommand(maps, commandName) {
  return maps.updates?.[commandName] ?? maps.mutationInvalidatesQueries?.[commandName] ?? []
}

export function updateTargetMatchesRun(target, run, { sourceParams = {}, equal = sameValue } = {}) {
  return paramsMatchPattern(run.params ?? {}, target.paramsPattern ?? {}, sourceParams, equal)
}

export const normalizeInvalidationMaps = normalizeUpdateMaps
export const reverseInvalidationMap = reverseUpdateMap
export const validateInvalidationMaps = validateUpdateMaps
export const invalidationTargetsForMutation = updateTargetsForCommand
export const invalidationTargetMatchesRun = updateTargetMatchesRun
