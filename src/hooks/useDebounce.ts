import { useCallback, useRef } from 'react'

/**
 * Debounce hook that delays function execution until after delay has elapsed
 * @param callback The function to debounce
 * @param delay Delay in milliseconds before execution
 * @returns Debounced function
 */
const useDebounce = <T extends (...args: any[]) => any>(callback: T, delay: number) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  return useCallback(
    (...args: Parameters<T>) => {
      timerRef.current && clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        callback(...args)
      }, delay)
    },
    [callback, delay]
  )
}

export default useDebounce
