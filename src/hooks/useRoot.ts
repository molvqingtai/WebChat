import { getRootNode } from '@/utils'
import { useState } from 'react'

const useRoot = () => {
  // The root host is created before this hook renders, so the lookup is a first-render value.
  const [root] = useState<Element>(() => getRootNode())
  return root
}

export default useRoot
