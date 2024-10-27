import { ForwardedRef, MutableRefObject, RefCallback, useCallback } from 'react'

const useShareRef = <T extends HTMLElement | null>(
  ...refs: (MutableRefObject<T> | ForwardedRef<T> | RefCallback<T>)[]
) => {
  const setRef = useCallback(
    (node: T) =>
      refs.forEach((ref) => {
        if (typeof ref === 'function') {
          ref(node)
        } else if (ref) {
          ref.current = node
        }
      }),
    [...refs]
  )

  return setRef
}

export default useShareRef
