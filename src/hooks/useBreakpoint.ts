import { useMedia } from 'react-use'
import { BREAKPOINTS } from '@/constants'

const useBreakpoint = () => {
  const isSM = useMedia(`(min-width: ${BREAKPOINTS.sm})`)
  const isMD = useMedia(`(min-width: ${BREAKPOINTS.md})`)
  const isLG = useMedia(`(min-width: ${BREAKPOINTS.lg})`)
  const isXL = useMedia(`(min-width: ${BREAKPOINTS.xl})`)
  const is2XL = useMedia(`(min-width: ${BREAKPOINTS['2xl']})`)
  return {
    isSM,
    isMD,
    isLG,
    isXL,
    is2XL
  }
}

export default useBreakpoint
