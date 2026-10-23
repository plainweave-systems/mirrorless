import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MirrorlessCell, ValueRef, cloneFrozenJson, cloneJson, deepFreeze, derefValue,
  parseFrozenJson, sameParams, sameValue, valueRef,
} from '../../src/core/index.js'

test('JSON parsing freezes every nested object and array', () => {
  const value = parseFrozenJson('{"items":[{"id":1}]}')
  assert.ok(Object.isFrozen(value))
  assert.ok(Object.isFrozen(value.items))
  assert.ok(Object.isFrozen(value.items[0]))
  assert.throws(() => { value.items[0].id = 2 }, TypeError)
})

test('cloning copies caller values rather than freezing them in place', () => {
  const input = { nested: { a: 1 }, unset: undefined }
  const copy = cloneFrozenJson(input)
  assert.deepEqual(copy, { nested: { a: 1 } })
  assert.notEqual(copy.nested, input.nested)
  assert.equal(Object.isFrozen(input), false)
  assert.equal(Object.isFrozen(input.nested), false)
  input.nested.a = 2
  assert.equal(copy.nested.a, 1)
  assert.equal(cloneJson(undefined), undefined)
})

test('deepFreeze traverses already-frozen parents and cyclic graphs', () => {
  const child = { a: 1 }
  const parent = Object.freeze({ child })
  deepFreeze(parent)
  assert.ok(Object.isFrozen(child))
  const cyclic = { a: {} }
  cyclic.self = cyclic
  assert.equal(deepFreeze(cyclic), cyclic)
  assert.ok(Object.isFrozen(cyclic.a))
})

test('value equality ignores object key order while retaining array order and missing keys', () => {
  assert.ok(sameParams({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }))
  assert.ok(sameParams(null, undefined))
  assert.equal(sameValue([1, 2], [2, 1]), false)
  assert.equal(sameValue({ a: undefined }, {}), false)
  assert.equal(sameValue([, 1], [undefined, 1]), false)
  assert.ok(sameValue(NaN, NaN))
  assert.equal(sameValue(-0, 0), false)
})

test('value equality supports dates, regexps, enumerable symbols, and cyclic plain objects', () => {
  assert.ok(sameValue(new Date(0), new Date(0)))
  assert.equal(sameValue(new Date(0), new Date(1)), false)
  assert.ok(sameValue(/a/gi, /a/gi))
  const key = Symbol('a')
  assert.ok(sameValue({ [key]: 1 }, { [key]: 1 }))
  const a = {}; a.self = a
  const b = {}; b.self = b
  assert.ok(sameValue(a, b))
  assert.equal(sameValue(new Map([['a', 1]]), new Map([['b', 2]])), false)
})

test('value equality ignores repeated sibling identity symmetrically, including arrays', () => {
  const shared = { id: 1 }
  const pairs = [
    [{ from: shared, to: shared }, { from: { id: 1 }, to: { id: 1 } }],
    [[shared, shared], [{ id: 1 }, { id: 1 }]],
    [{ items: [shared, shared], other: shared }, { items: [{ id: 1 }, { id: 1 }], other: { id: 1 } }],
  ]
  for (const [left, right] of pairs) {
    assert.equal(sameParams(left, right), true)
    assert.equal(sameParams(right, left), true)
    assert.equal(sameValue(left, right), true)
    assert.equal(sameValue(right, left), true)
  }
})

test('active-path cycle matching remains symmetric and supports repeated cyclic siblings', () => {
  const a = { id: 1 }; a.self = a
  const b = { id: 1 }; b.self = b
  const c = { id: 1 }; c.self = c
  assert.equal(sameValue({ from: a, to: a }, { from: b, to: c }), true)
  assert.equal(sameValue({ from: b, to: c }, { from: a, to: a }), true)
  const twoCycle = { id: 1, self: { id: 1 } }; twoCycle.self.self = twoCycle
  assert.equal(sameValue(a, twoCycle), false)
  assert.equal(sameValue(twoCycle, a), false)
})

test('value references preserve identity and avoid nesting wrappers', () => {
  const object = { id: 1 }
  const ref = valueRef(object)
  assert.ok(ref instanceof ValueRef)
  assert.equal(valueRef(ref), ref)
  assert.equal(derefValue(ref), object)
  assert.equal(derefValue(object), object)
})

test('cells notify once for a changed reference and clean up independently', () => {
  const cell = new MirrorlessCell(1)
  const values = []
  const stop = cell.subscribe((value) => values.push(value))
  cell.set(1)
  cell.set(2)
  stop()
  stop()
  cell.set(3)
  assert.deepEqual(values, [2])
  assert.equal(cell.get(), 3)
})
