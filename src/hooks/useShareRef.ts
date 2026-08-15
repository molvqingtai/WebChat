import type { Ref } from 'react'
import { useCallback } from 'react'

export const setRef = <T>(ref: Ref<T> | undefined, value: T) => {
  if (typeof ref === 'function') {
    return ref(value)
  } else if (ref !== null && ref !== undefined) {
    ref.current = value
  }
}

const useShareRef = <T>(...refs: (Ref<T> | undefined)[]) => {
  return useCallback(
    (node: T) => {
      const cleanups = refs.map((ref) => setRef(ref, node))
      return () =>
        cleanups.forEach((cleanup, index) => (typeof cleanup === 'function' ? cleanup() : setRef(refs[index], null)))
    },
    [...refs]
  )
}

export default useShareRef
