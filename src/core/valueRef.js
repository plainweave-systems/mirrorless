export class ValueRef {
  constructor(value) {
    this.value = value
  }
}

export function valueRef(value) {
  return value instanceof ValueRef ? value : new ValueRef(value)
}

export function derefValue(value) {
  return value instanceof ValueRef ? value.value : value
}
