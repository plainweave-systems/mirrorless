import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createMirrorless, normalizeOperationTerm, normalizeUpdateMaps, operationMatchesTerm,
  paramsMatchPattern, resolvePatternValue, reverseUpdateMap, symbolBindingKey,
  validateUpdateMaps, updateTargetsForCommand,
} from '../../src/core/index.js'

test('bare names and broad tuples normalize equivalently without mutating caller patterns', () => {
  assert.deepEqual(normalizeOperationTerm('Read'), normalizeOperationTerm(['Read']))
  assert.deepEqual(normalizeOperationTerm('Read'), normalizeOperationTerm(['Read', {}]))
  const pattern = { nested: { a: 1 }, id: Symbol.for('id') }
  const normalized = normalizeOperationTerm(['Read', pattern])
  assert.notEqual(normalized.paramsPattern, pattern)
  assert.ok(Object.isFrozen(normalized.paramsPattern.nested))
  assert.equal(Object.isFrozen(pattern), false)
  pattern.nested.a = 2
  assert.equal(normalized.paramsPattern.nested.a, 1)
})

test('invalid terms fail immediately', () => {
  for (const term of ['', [], [null], ['Read', null], ['Read', []], ['Read', 1], ['Read', {}, {}], null, {}]) {
    assert.throws(() => normalizeOperationTerm(term), TypeError)
  }
})

test('false update-map flags are explicitly invalid while false literals and predicates remain valid', () => {
  assert.throws(() => createMirrorless({ updates: { Save: { Read: false } } }), TypeError)
  assert.doesNotThrow(() => createMirrorless({ updates: { Save: { Read: { done: false } } } }).dispose())
  assert.doesNotThrow(() => createMirrorless({ updates: { Save: { Read: () => false } } }).dispose())
})

test('patterns combine AND keys, literal deep equality, and symbol source remapping', () => {
  const pattern = { id: Symbol.for('sourceId'), status: 'done', scope: { owner: 1 } }
  assert.ok(paramsMatchPattern({ id: 42, status: 'done', scope: { owner: 1 }, other: true }, pattern, { sourceId: 42 }))
  assert.equal(paramsMatchPattern({ id: 42, status: 'active', scope: { owner: 1 } }, pattern, { sourceId: 42 }), false)
  assert.equal(paramsMatchPattern({ id: 42, status: 'done' }, pattern, { sourceId: 42 }), false)
  assert.equal(paramsMatchPattern({ id: 42, status: 'done', scope: { owner: 1 } }, pattern, {}), false)
})

test('bindings require an own source key, including for undefined and prototype names', () => {
  assert.deepEqual(resolvePatternValue(Symbol.for('id'), {}), { found: false, value: undefined })
  assert.deepEqual(resolvePatternValue(Symbol.for('id'), { id: undefined }), { found: true, value: undefined })
  assert.equal(resolvePatternValue(Symbol.for('constructor'), {}).found, false)
  assert.equal(symbolBindingKey(Symbol('localId')), 'localId')
  assert.equal(symbolBindingKey(Symbol.for('id')), 'id')
  assert.equal(paramsMatchPattern({}, { id: undefined }), false)
})

test('operation matching checks both name and pattern using configured equality', () => {
  const caseInsensitive = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
  assert.ok(operationMatchesTerm('Read', { id: 'ABC' }, ['Read', { id: Symbol.for('id') }], { id: 'abc' }, caseInsensitive))
  assert.equal(operationMatchesTerm('Other', { id: 'ABC' }, 'Read'), false)
})

test('forward targets retain OR alternatives, literals, and predicates', () => {
  const predicate = () => true
  const maps = normalizeUpdateMaps({ updates: {
    Move: [['Read', { id: Symbol.for('from') }], ['Read', { id: Symbol.for('to') }], 'List'],
    Save: { Read: predicate, Summary: true },
  } })
  assert.equal(maps.updates.Move.length, 3)
  assert.equal(maps.updates.Save[0].predicate, predicate)
  assert.equal(updateTargetsForCommand(maps, 'Absent').length, 0)
  assert.equal(maps.updates, maps.mutationInvalidatesQueries)
  assert.ok(Object.isFrozen(maps.updates.Move))
})

test('reverse terms preserve patterns instead of silently discarding their bindings', () => {
  const maps = normalizeUpdateMaps({
    updates: { Save: [['Read', { id: Symbol.for('id') }]] },
    updatedBy: { Read: [['Save', { id: Symbol.for('id') }]] },
  })
  assert.equal(maps.updatedBy.Read[0].commandName, 'Save')
  assert.equal(maps.updatedBy.Read[0].paramsPattern.id, Symbol.for('id'))
  assert.equal(maps.updatedBy.Read[0].term[1].id, Symbol.for('id'))
})

test('name-only reverse derivation deduplicates edges without pretending to invert predicates', () => {
  const inverse = reverseUpdateMap({ Move: [['Read', { id: Symbol.for('from') }], ['Read', { id: Symbol.for('to') }]] })
  assert.deepEqual([...inverse.Read], ['Move'])
  assert.deepEqual(validateUpdateMaps({ updates: { Move: ['Read'] } }), [])
})

test('validation audits malformed terms, unknown names, and forward/reverse edge presence', () => {
  assert.match(validateUpdateMaps({ updates: { Save: [['Read', null]] } })[0], /Invalid/)
  const errors = validateUpdateMaps({
    updates: { Save: ['Read'] },
    updatedBy: { Other: ['Unknown'] },
    knownQueries: new Set(['Read']),
    knownCommands: new Set(['Save']),
  })
  assert.ok(errors.includes('Missing reverse update edge: Read <- Save'))
  assert.ok(errors.includes('Unknown query in updatedBy: Other'))
  assert.ok(errors.includes('Unknown command in updatedBy.Other: Unknown'))
  assert.ok(errors.includes('Missing forward update edge: Unknown -> Other'))
})

test('operation names inherited from Object.prototype are safe dictionary keys', () => {
  const updates = JSON.parse('{"__proto__":["toString"]}')
  const maps = normalizeUpdateMaps({ updates })
  assert.equal(maps.updates.__proto__[0].queryName, 'toString')
  assert.deepEqual(updateTargetsForCommand(maps, 'constructor'), [])
  assert.equal(Object.getPrototypeOf(maps.updates), null)
})
