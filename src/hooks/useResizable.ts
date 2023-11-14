import { useCallback, useEffect, useRef, useState } from 'react'

export interface ResizableOptions {
  minSize: number
  maxSize: number
  initSize: number
  direction: 'left' | 'right' | 'top' | 'bottom'
}

const useResizable = (options: ResizableOptions) => {
  const { minSize, maxSize, initSize = 0, direction } = options

  const [size, setSize] = useState(initSize)

  const [position, setPosition] = useState(0)

  const [isMove, setIsMove] = useState(false)

  const directionXY = direction === 'left' || direction === 'right' ? 'X' : 'Y'

  const handleStart = (e: MouseEvent) => {
    const { screenY, screenX } = e
    setIsMove(true)
    setPosition(directionXY === 'Y' ? screenY : screenX)
    document.documentElement.style.userSelect = 'none'
    document.documentElement.style.cursor = directionXY === 'Y' ? 'ns-resize' : 'ew-resize'
  }
  const handleEnd = () => {
    setIsMove(false)
    document.documentElement.style.cursor = ''
    document.documentElement.style.userSelect = ''
  }

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (isMove) {
        console.log('move')
        const { screenY, screenX } = e
        let delta = 0
        switch (direction) {
          case 'left':
            delta = position - screenX
            break
          case 'right':
            delta = screenX - position
            break
          case 'top':
            delta = position - screenY
            break
          case 'bottom':
            delta = screenY - position
            break
        }

        const newSize = size + delta
        if (size !== newSize && newSize >= minSize && newSize <= maxSize) {
          setSize(newSize)
        }
      } else {
        document.removeEventListener('mousemove', handleMove)
      }
    }

    document.addEventListener('mousemove', handleMove)
    return () => {
      document.removeEventListener('mousemove', handleMove)
    }
  }, [isMove])

  const ref = useRef<HTMLElement | null>(null)
  const setRef = useCallback((node: HTMLElement | null) => {
    if (ref.current) {
      ref.current.removeEventListener('mousedown', handleStart)
      document.removeEventListener('mouseup', handleEnd)
    }
    if (node) {
      node.addEventListener('mousedown', handleStart)
      document.addEventListener('mouseup', handleEnd)
    }
    ref.current = node
  }, [])

  return { size, ref: setRef }
}

export default useResizable
