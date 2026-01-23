import { useCallback, useRef } from 'react'

/**
 * Throttle hook that limits function execution rate
 * @param callback The function to throttle
 * @param delay Minimum time between executions in milliseconds
 * @returns Throttled function
 */
const useThrottle = <T extends (...args: any[]) => any>(callback: T, delay: number) => {
  const lastExecutionTime = useRef<number>(0)

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now()
      const timeSinceLastExecution = now - lastExecutionTime.current

      if (timeSinceLastExecution >= delay) {
        lastExecutionTime.current = now
        return callback(...args)
      }
    },
    [callback, delay]
  )
}

export default useThrottle
