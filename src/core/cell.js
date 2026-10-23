export class MirrorlessCell {
  constructor(initialValue) {
    this.value = initialValue
    this.listeners = new Set()
  }

  get() {
    return this.value
  }

  set(value) {
    if (Object.is(this.value, value)) return
    this.value = value
    for (const listener of [...this.listeners]) listener(value)
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export { MirrorlessCell as ServerStateCell }
