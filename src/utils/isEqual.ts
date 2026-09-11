const isEqual = <Value>(a: Value, b: Value) => {
  return JSON.stringify(a) === JSON.stringify(b)
}

export default isEqual
