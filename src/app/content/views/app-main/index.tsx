import { type ReactNode, type FC, useState, useMemo } from 'react'
import useResizable from '@/hooks/useResizable'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils'
import type { AppGeometry } from '@/app/content/views/app-layout/geometry'

export interface AppMainProps {
  children?: ReactNode
  className?: string
  open: boolean
  geometry: AppGeometry['shell']
}

const AppMain: FC<AppMainProps> = ({ children, className, open, geometry }) => {
  const { size, setRef } = useResizable({
    initSize: geometry.minimumWidth,
    maxSize: geometry.maximumWidth,
    minSize: geometry.minimumWidth,
    direction: geometry.isOnRightSide ? 'left' : 'right'
  })

  const [isAnimationComplete, setIsAnimationComplete] = useState(false)

  // Memoize children to prevent unnecessary re-renders when position changes
  const memoizedChildren = useMemo(() => children, [children])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-webchat-panel
          initial={{ opacity: 0, y: 10, x: 'var(--webchat-shell-translate-x)' }}
          animate={{ opacity: 1, y: 0, x: 'var(--webchat-shell-translate-x)' }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.3, ease: 'linear' }}
          onAnimationEnd={() => setIsAnimationComplete(true)}
          onAnimationStart={() => setIsAnimationComplete(false)}
          style={{
            width: `${size}px`,
            left: 'var(--webchat-launcher-left)',
            bottom: 'calc(var(--webchat-launcher-bottom) + var(--webchat-shell-bottom-offset))',
            height: 'var(--webchat-shell-height)'
          }}
          className={cn(
            'z-infinity fixed box-border grid grid-flow-col grid-rows-[auto_1fr_auto] rounded-xl bg-slate-50 font-sans shadow-2xl dark:bg-slate-950',
            className,
            { 'transition-transform': isAnimationComplete }
          )}
        >
          {memoizedChildren}
          <div
            ref={setRef}
            className={cn(
              'absolute inset-y-3 z-infinity w-1 dark:bg-slate-600 cursor-ew-resize rounded-xl bg-slate-100 opacity-0 shadow transition-opacity duration-200 ease-in hover:opacity-100',
              geometry.isOnRightSide ? '-left-0.5' : '-right-0.5'
            )}
          ></div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

AppMain.displayName = 'AppMain'

export default AppMain
