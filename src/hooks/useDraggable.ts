import { clamp, isInRange } from '@/utils'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

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

  const [position, setPosition] = useState({ x: clamp(initX, minX, maxX), y: clamp(initY, minY, maxY) })

  useLayoutEffect(() => {
    const newPosition = { x: clamp(initX, minX, maxX), y: clamp(initY, minY, maxY) }
    if (JSON.stringify(newPosition) !== JSON.stringify(position)) {
      setPosition(newPosition)
    }
  }, [initX, initY, maxX, minX, maxY, minY])

  const isMove = useRef(false)

  const handleMove = useCallback(
    (e: MouseEvent) => {
      if (isMove.current) {
        const { clientX, clientY } = e
        const delta = {
          x: position.x + clientX - mousePosition.current.x,
          y: position.y + clientY - mousePosition.current.y
        }

        const hasChanged = delta.x !== position.x || delta.y !== position.y

        if (isInRange(delta.x, minX, maxX)) {
          mousePosition.current.x = clientX
        }
        if (isInRange(delta.y, minY, maxY)) {
          mousePosition.current.y = clientY
        }
        if (hasChanged) {
          setPosition(() => {
            const x = clamp(delta.x, minX, maxX)
            const y = clamp(delta.y, minY, maxY)
            return { x, y }
          })
        }
      }
    },
    [minX, maxX, minY, maxY, position]
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
