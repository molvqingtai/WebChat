const invoke = <T extends any[], U>(callback: (...args: T) => U, ...args: T) => {
  return callback(...args)
}

export default invoke
