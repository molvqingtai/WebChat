import { cn } from '@/utils'
import type { Ref } from 'react'

export interface DanmakuContainerProps {
  className?: string
}

const DanmakuContainer = ({ ref, className }: DanmakuContainerProps & { ref?: Ref<HTMLDivElement | null> }) => {
  return (
    <div
      className={cn('fixed left-0 top-0 z-infinity w-full h-full invisible pointer-events-none shadow-md', className)}
      ref={ref}
    ></div>
  )
}

DanmakuContainer.displayName = 'DanmakuContainer'

export default DanmakuContainer
