import { clamp, isInRange } from '@/utils'
import { startTransition, useCallback, useEffect, useRef, useState } from 'react'

export interface DargOptions {
  initX: number
  initY: number
  maxX: number
  minX: number
  maxY: number
  minY: number
  reverse?: boolean // If true, position is calculated from bottom-right corner
}

const useDraggable = (options: DargOptions) => {
  const { initX, initY, maxX = 0, minX = 0, maxY = 0, minY = 0, reverse = false } = options

  const mousePosition = useRef({ x: 0, y: 0 })

  // Convert to internal coordinates if reverse mode
  const toInternal = (x: number, y: number) => {
    if (!reverse) return { x, y }
    return {
      x: window.innerWidth - x,
      y: window.innerHeight - y
    }
  }

  // Convert from internal coordinates if reverse mode
  const fromInternal = (x: number, y: number) => {
    if (!reverse) return { x, y }
    return {
      x: window.innerWidth - x,
      y: window.innerHeight - y
    }
  }

  const internalInit = toInternal(initX, initY)
  const positionRef = useRef({ x: clamp(internalInit.x, minX, maxX), y: clamp(internalInit.y, minY, maxY) })
  const [position, setPosition] = useState(() => fromInternal(positionRef.current.x, positionRef.current.y))

  useEffect(() => {
    const internal = toInternal(initX, initY)
    const newPosition = { x: clamp(internal.x, minX, maxX), y: clamp(internal.y, minY, maxY) }
    if (JSON.stringify(newPosition) !== JSON.stringify(positionRef.current)) {
      startTransition(() => {
        positionRef.current = newPosition
        setPosition(fromInternal(newPosition.x, newPosition.y))
      })
    }
  }, [initX, initY, maxX, minX, maxY, minY, reverse])

  const isMove = useRef(false)

  const handleMove = useCallback(
    (e: MouseEvent) => {
      if (isMove.current) {
        const { clientX, clientY } = e
        const prev = positionRef.current
        const delta = {
          x: prev.x + clientX - mousePosition.current.x,
          y: prev.y + clientY - mousePosition.current.y
        }

        const hasChanged = delta.x !== prev.x || delta.y !== prev.y

        if (isInRange(delta.x, minX, maxX)) {
          mousePosition.current.x = clientX
        }
        if (isInRange(delta.y, minY, maxY)) {
          mousePosition.current.y = clientY
        }
        if (hasChanged) {
          const x = clamp(delta.x, minX, maxX)
          const y = clamp(delta.y, minY, maxY)
          startTransition(() => {
            positionRef.current = { x, y }
            setPosition(fromInternal(x, y))
          })
        }
      }
    },
    [minX, maxX, minY, maxY, reverse]
  )

  const handleEnd = useCallback(() => {
    isMove.current = false
    document.documentElement.style.cursor = ''
    document.documentElement.style.userSelect = ''
  }, [])

  const handleStart = useCallback((e: MouseEvent) => {
    const { clientX, clientY } = e
    mousePosition.current = { x: clientX, y: clientY }
    isMove.current = true
    document.documentElement.style.userSelect = 'none'
    document.documentElement.style.cursor = 'grab'
  }, [])

  const handleRef = useRef<HTMLElement | null>(null)

  const setRef = useCallback(
    (node: HTMLElement | null) => {
      if (handleRef.current) {
        handleRef.current.removeEventListener('mousedown', handleStart)
        document.removeEventListener('mouseup', handleEnd)
        document.removeEventListener('mousemove', handleMove)
      }
      if (node) {
        node.addEventListener('mousedown', handleStart)
        document.addEventListener('mouseup', handleEnd)
        document.addEventListener('mousemove', handleMove)
      }
      handleRef.current = node
    },
    [handleEnd, handleMove, handleStart]
  )

  return { setRef, ...position }
}

export default useDraggable
