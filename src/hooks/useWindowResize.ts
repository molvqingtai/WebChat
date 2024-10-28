import { useEffect, useState } from 'react'

const useWindowResize = (callback?: ({ width, height }: { width: number; height: number }) => void) => {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })

  useEffect(() => {
    const handler = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      setSize({ width, height })
      callback?.({ width, height })
    }
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('resize', handler)
    }
  }, [])

  return size
}

export default useWindowResize
