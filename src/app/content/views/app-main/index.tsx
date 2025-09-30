import { type ReactNode, type FC, useState } from 'react'
import useResizable from '@/hooks/useResizable'
import { motion, AnimatePresence } from 'framer-motion'
import AppStatusDomain from '@/domain/AppStatus'
import { useRemeshDomain, useRemeshQuery } from 'remesh-react'
import { cn } from '@/utils'
import useWindowResize from '@/hooks/useWindowResize'

export interface AppMainProps {
  children?: ReactNode
  className?: string
}

const AppMain: FC<AppMainProps> = ({ children, className }) => {
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const appOpenStatus = useRemeshQuery(appStatusDomain.query.OpenQuery())
  const { x, y } = useRemeshQuery(appStatusDomain.query.PositionQuery())

  const { width, height } = useWindowResize()

  // Position x,y is offset from bottom-right corner
  // Convert to absolute position from left for comparison
  const absoluteX = width - x
  const absoluteY = height - y

  const isOnRightSide = absoluteX >= width / 2 + 50

  const { size, setRef } = useResizable({
    initSize: Math.max(375, width / 6),
    maxSize: Math.max(Math.min(750, width / 3), 375),
    minSize: Math.max(375, width / 6),
    direction: isOnRightSide ? 'left' : 'right'
  })

  const [isAnimationComplete, setAnimationComplete] = useState(false)

  return (
    <AnimatePresence>
      {appOpenStatus && (
        <motion.div
          initial={{ opacity: 0, y: 10, x: isOnRightSide ? '-100%' : '0' }}
          animate={{ opacity: 1, y: 0, x: isOnRightSide ? '-100%' : '0' }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.3, ease: 'linear' }}
          onAnimationEnd={() => setAnimationComplete(true)}
          onAnimationStart={() => setAnimationComplete(false)}
          style={{
            width: `${size}px`,
            left: `${absoluteX}px`,
            bottom: `calc(100vh - ${absoluteY}px + 22px)`
          }}
          className={cn(
            `fixed inset-y-10 right-10 z-infinity mb-0 mt-auto box-border grid max-h-[min(calc(100vh_-60px),_1000px)] min-h-[375px] grid-flow-col grid-rows-[auto_1fr_auto] rounded-xl bg-slate-50 dark:bg-slate-950 font-sans shadow-2xl`,
            className,
            { 'transition-transform': isAnimationComplete }
          )}
        >
          {children}
          <div
            ref={setRef}
            className={cn(
              'absolute inset-y-3 z-infinity w-1 dark:bg-slate-600 cursor-ew-resize rounded-xl bg-slate-100 opacity-0 shadow transition-opacity duration-200 ease-in hover:opacity-100',
              isOnRightSide ? '-left-0.5' : '-right-0.5'
            )}
          ></div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

AppMain.displayName = 'AppMain'

export default AppMain
