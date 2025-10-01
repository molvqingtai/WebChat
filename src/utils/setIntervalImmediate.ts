const setIntervalImmediate = <T extends any[] = any[]>(handler: (...args: T) => void, delay?: number, ...args: T) => {
  let timer = setTimeout(() => {
    clearTimeout(timer)
    handler(...args)
    timer = setInterval(handler, delay, ...args)
  }, 0)
  return () => clearInterval(timer)
}

export default setIntervalImmediate
