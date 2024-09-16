const throttle = <F extends (...args: any[]) => any>(func: F, wait: number, immediate = false) => {
  let lastTime = 0
  let firstCall = true

  return function (this: ThisParameterType<F>, ...args: Parameters<F>): void {
    const nowTime = Date.now()

    if ((firstCall && immediate) || nowTime - lastTime >= wait) {
      func.apply(this, args)
      lastTime = nowTime
      firstCall = false
    }
  }
}

export default throttle
