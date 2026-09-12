import type { Ref } from 'react'
import { useCallback, useEffect, useRef } from 'react'

export const setRef = <T>(ref: Ref<T> | undefined, value: T) => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- React Ref is a function-or-object union
  if (typeof ref === 'function') {
    return ref(value)
  } else if (ref !== null && ref !== undefined) {
    ref.current = value
  }
}

const useShareRef = <T>(...refs: (Ref<T> | undefined)[]) => {
  const refsRef = useRef(refs)
  // Keep the shared callback stable while still targeting the latest refs after commit.
  useEffect(() => {
    refsRef.current = refs
  })
  return useCallback((node: T) => {
    const cleanups = refsRef.current.map((ref) => setRef(ref, node))
    return () =>
      cleanups.forEach((cleanup, index) =>
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- React Ref cleanup is a function-or-void union
        typeof cleanup === 'function' ? cleanup() : setRef(refsRef.current[index], null)
      )
  }, [])
}

export default useShareRef
