import { RefCallback, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { clamp, isInRange } from '@/utils'

export interface ResizableOptions {
  minSize: number
  maxSize: number
  initSize: number
  direction: 'left' | 'right' | 'top' | 'bottom'
}

const useResizable = (options: ResizableOptions) => {
  const { minSize, maxSize, initSize = 0, direction } = options

  const [size, setSize] = useState(clamp(initSize, minSize, maxSize))

  useLayoutEffect(() => {
    const newSize = clamp(initSize, minSize, maxSize)
    if (newSize !== size) {
      setSize(newSize)
    }
  }, [initSize, minSize, maxSize])

  const position = useRef(0)

  const isMove = useRef(false)

  const isHorizontal = direction === 'left' || direction === 'right'

  const handleMove = useCallback(
    (e: MouseEvent) => {
      if (isMove.current) {
        const { screenY, screenX } = e
        let delta = 0
        switch (direction) {
          case 'left':
            delta = position.current - screenX
            break
          case 'right':
            delta = screenX - position.current
            break
          case 'top':
            delta = position.current - screenY
            break
          case 'bottom':
            delta = screenY - position.current
            break
        }
        const newSize = size + delta
        if (isInRange(newSize, minSize, maxSize)) {
          position.current = isHorizontal ? screenX : screenY
        }
        if (newSize !== size) {
          setSize(clamp(newSize, minSize, maxSize))
        }
      }
    },
    [direction, isHorizontal, maxSize, minSize, size]
  )

  const handleEnd = useCallback(() => {
    isMove.current = false
    document.documentElement.style.cursor = ''
    document.documentElement.style.userSelect = ''
  }, [])

  const handleStart = useCallback(
    (e: MouseEvent) => {
      const { screenY, screenX } = e
      isMove.current = true
      position.current = isHorizontal ? screenX : screenY
      document.documentElement.style.userSelect = 'none'
      document.documentElement.style.cursor = isHorizontal ? 'ew-resize' : 'ns-resize'
    },
    [isHorizontal]
  )

  const handlerRef = useRef<HTMLElement | null>(null)

  // Watch ref: https://medium.com/@teh_builder/ref-objects-inside-useeffect-hooks-eb7c15198780
  const setRef: RefCallback<HTMLElement | null> = useCallback(
    (node) => {
      if (handlerRef.current) {
        handlerRef.current.removeEventListener('mousedown', handleStart)
        document.removeEventListener('mouseup', handleEnd)
        document.removeEventListener('mousemove', handleMove)
      }
      if (node) {
        node.addEventListener('mousedown', handleStart)
        document.addEventListener('mouseup', handleEnd)
        document.addEventListener('mousemove', handleMove)
      }
      handlerRef.current = node
    },
    [handleEnd, handleMove, handleStart]
  )

  return { size, setRef }
}

export default useResizable
