import { clamp, isInRange } from '@/utils'
import { useCallback, useRef } from 'react'

export interface DragOptions {
  x: number
  y: number
  maxX: number
  minX: number
  maxY: number
  minY: number
  onChange?: (position: { x: number; y: number }) => void
}

const useDraggable = ({ x, y, maxX, minX, maxY, minY, onChange }: DragOptions) => {
  const mousePosition = useRef({ x: 0, y: 0 })
  const position = { x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) }
  const positionRef = useRef(position)
  positionRef.current = position
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const isMove = useRef(false)
  const rafRef = useRef<number | null>(null)
  const latestMousePosition = useRef({ x: 0, y: 0 })

  const handleMove = useCallback(
    (event: MouseEvent) => {
      if (!isMove.current) return
      latestMousePosition.current = { x: event.clientX, y: event.clientY }
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const previous = positionRef.current
        const delta = {
          x: previous.x + latestMousePosition.current.x - mousePosition.current.x,
          y: previous.y + latestMousePosition.current.y - mousePosition.current.y
        }

        if (isInRange(delta.x, minX, maxX)) mousePosition.current.x = latestMousePosition.current.x
        if (isInRange(delta.y, minY, maxY)) mousePosition.current.y = latestMousePosition.current.y

        const next = { x: clamp(delta.x, minX, maxX), y: clamp(delta.y, minY, maxY) }
        if (next.x === previous.x && next.y === previous.y) return
        positionRef.current = next
        onChangeRef.current?.(next)
      })
    },
    [minX, maxX, minY, maxY]
  )

  const handleEnd = useCallback(() => {
    isMove.current = false
    document.documentElement.style.cursor = ''
    document.documentElement.style.userSelect = ''
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  const handleStart = useCallback((event: MouseEvent) => {
    mousePosition.current = { x: event.clientX, y: event.clientY }
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
