import { createBreakpoint } from 'react-use'
import { BREAKPOINTS } from '@/constants'

const _useBreakpoint = createBreakpoint(BREAKPOINTS)

const useBreakpoint = () => {
  const breakpoint = _useBreakpoint() as keyof typeof BREAKPOINTS

  return {
    isSM: breakpoint === 'sm',
    isMD: breakpoint === 'md',
    isLG: breakpoint === 'lg',
    isXL: breakpoint === 'xl',
    is2XL: breakpoint === '2xl'
  }
}

export default useBreakpoint
