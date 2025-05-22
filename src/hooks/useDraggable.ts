import { clamp, isInRange } from '@/utils'
import { startTransition, useCallback, useLayoutEffect, useRef, useState } from 'react'

export interface DargOptions {
  initX: number
  initY: number
  maxX: number
  minX: number
  maxY: number
  minY: number
}

const useDraggable = (options: DargOptions) => {
  const { initX, initY, maxX = 0, minX = 0, maxY = 0, minY = 0 } = options

  const mousePosition = useRef({ x: 0, y: 0 })
  const positionRef = useRef({ x: clamp(initX, minX, maxX), y: clamp(initY, minY, maxY) })
  const [position, setPosition] = useState(positionRef.current)

  useLayoutEffect(() => {
    const newPosition = { x: clamp(initX, minX, maxX), y: clamp(initY, minY, maxY) }
    if (JSON.stringify(newPosition) !== JSON.stringify(position)) {
      startTransition(() => {
        positionRef.current = newPosition
        setPosition(newPosition)
      })
    }
  }, [initX, initY, maxX, minX, maxY, minY])

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
          positionRef.current = { x, y }
          startTransition(() => {
            setPosition({ x, y })
          })
        }
      }
    },
    [minX, maxX, minY, maxY]
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
