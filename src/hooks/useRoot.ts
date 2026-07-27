import { getRootNode } from '@/utils'
import { useLayoutEffect, useState } from 'react'

const useRoot = () => {
  const [root, setRoot] = useState<Element | null>(null)
  useLayoutEffect(() => {
    setRoot(getRootNode())
  }, [])
  return root
}

export default useRoot
