import { RefCallback, useCallback, useRef, useState } from 'react'
import getCursorPosition, { Position } from '@/utils/getCursorPosition'

const useCursorPosition = () => {
  const [position, setPosition] = useState<Position>({ x: 0, y: 0, selectionStart: 0, selectionEnd: 0 })

  const handler = async (e: Event) => {
    const newPosition = await getCursorPosition(e.target as HTMLInputElement | HTMLTextAreaElement)
    if (JSON.stringify(newPosition) !== JSON.stringify(position)) {
      setPosition(newPosition)
    }
  }

  const handleRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  const setRef: RefCallback<HTMLInputElement | HTMLTextAreaElement | null> = useCallback(
    (node) => {
      if (handleRef.current) {
        handleRef.current.removeEventListener('click', handler)
        handleRef.current.removeEventListener('input', handler)
        handleRef.current.removeEventListener('keydown', handler)
        handleRef.current.removeEventListener('keyup', handler)
        handleRef.current.removeEventListener('focus', handler)
      }
      if (node) {
        node.addEventListener('click', handler)
        node.addEventListener('input', handler)
        node.addEventListener('keydown', handler)
        node.addEventListener('keyup', handler)
        node.addEventListener('focus', handler)
      }
      handleRef.current = node
    },
    [handler]
  )

  return {
    ...position,
    setRef
  }
}

export default useCursorPosition
