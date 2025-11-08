import { getRootNode } from '@/utils'
import { useLayoutEffect, useState } from 'react'

const useRoot = () => {
  const [root, setRoot] = useState<Element | null>(null)
  useLayoutEffect(() => {
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect
    setRoot(getRootNode())
  }, [])
  return root
}

export default useRoot
