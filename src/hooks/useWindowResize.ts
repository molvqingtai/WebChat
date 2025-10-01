import { startTransition, useEffect, useState, useRef } from 'react'

const useWindowResize = (callback?: ({ width, height }: { width: number; height: number }) => void) => {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const handler = () => {
      // Cancel previous frame to ensure only one update per frame
      rafRef.current && cancelAnimationFrame(rafRef.current)

      rafRef.current = requestAnimationFrame(() => {
        const width = window.innerWidth
        const height = window.innerHeight
        startTransition(() => {
          setSize({ width, height })
          callback?.({ width, height })
        })
      })
    }
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('resize', handler)
      rafRef.current && cancelAnimationFrame(rafRef.current)
    }
  }, [callback])

  return size
}

export default useWindowResize
