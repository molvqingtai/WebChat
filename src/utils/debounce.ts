const debounce = <F extends (...args: any[]) => any>(func: F, wait: number, immediate = false) => {
  let timeout: ReturnType<typeof setTimeout> | null = null
  return function (this: ThisParameterType<F>, ...args: Parameters<F>) {
    timeout && clearTimeout(timeout)
    if (immediate && !timeout) {
      func.apply(this, args)
    }
    timeout = setTimeout(() => {
      timeout = null
      !immediate && func.apply(this, args)
    }, wait)
  }
}

export default debounce
