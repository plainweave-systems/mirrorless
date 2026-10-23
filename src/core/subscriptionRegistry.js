import { sameValue } from './equality.js'

export function createSubscriptionRegistry() {
  return { runs: new Map(), subscribers: new Map(), runSubscribers: new Map() }
}

export function subscriptionRegistry(registry) {
  return registry
}

export function subscriberIdsForRun(registry, runKey) {
  return [...(registry.runSubscribers.get(runKey) ?? [])]
}

export function runRecord(registry, runKey) {
  const run = registry.runs.get(runKey)
  return run ? { ...run, subscriberIds: subscriberIdsForRun(registry, runKey) } : undefined
}

export function allRuns(registry) {
  return [...registry.runs.keys()].map((key) => runRecord(registry, key))
}

export function runKeysForOperation(registry, operationName) {
  return [...registry.runs.values()]
    .filter((run) => run.operationName === operationName)
    .map((run) => run.runKey)
}

export function activeRunKeysForOperation(registry, operationName) {
  return runKeysForOperation(registry, operationName).filter((key) => subscriberIdsForRun(registry, key).length > 0)
}

export function findRunKey(registry, operationName, params, equal = sameValue) {
  return runKeysForOperation(registry, operationName).find((key) => equal(registry.runs.get(key).params, params ?? {}))
}
