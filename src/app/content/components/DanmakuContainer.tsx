import { cn } from '@/utils'
import { forwardRef } from 'react'

export interface DanmakuContainerProps {
  className?: string
}

const DanmakuContainer = forwardRef<HTMLDivElement, DanmakuContainerProps>(({ className }, ref) => {
  return (
    <div
      className={cn('fixed left-0 top-0 z-infinity w-full h-full invisible pointer-events-none shadow-md', className)}
      ref={ref}
    ></div>
  )
})

DanmakuContainer.displayName = 'DanmakuContainer'

export default DanmakuContainer
