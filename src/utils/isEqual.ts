const isEqual = (a: object, b: object) => {
  return JSON.stringify(a) === JSON.stringify(b)
}

export default isEqual
