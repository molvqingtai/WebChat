import { type ReactNode, type FC, useEffect, useState, useMemo } from 'react'
import useResizable from '@/hooks/useResizable'
import { motion, AnimatePresence } from 'framer-motion'
import AppStatusDomain from '@/domain/AppStatus'
import { useRemeshDomain, useRemeshQuery } from 'remesh-react'
import { cn } from '@/utils'
import useWindowResize from '@/hooks/useWindowResize'

export interface AppMainProps {
  children?: ReactNode
  className?: string
  toaster?: ReactNode
}

export interface AppMainFrameProps extends AppMainProps {
  open: boolean
  position: { x: number; y: number }
}

export const AppMainFrame: FC<AppMainFrameProps> = ({ children, className, toaster, open, position: { x, y } }) => {
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

  const [isAnimationComplete, setIsAnimationComplete] = useState(false)
  const [panelPositioned, setPanelPositioned] = useState(open)

  useEffect(() => {
    if (open) setPanelPositioned(true)
  }, [open])

  // Memoize children to prevent unnecessary re-renders when position changes
  const memoizedChildren = useMemo(() => children, [children])

  return (
    <div
      data-webchat-shell
      style={
        open || panelPositioned
          ? {
              width: `${size}px`,
              left: `${absoluteX}px`,
              bottom: `calc(100vh - ${absoluteY}px + 22px)`,
              transform: isOnRightSide ? 'translateX(-100%)' : 'translateX(0)'
            }
          : undefined
      }
      className={
        open || panelPositioned
          ? cn(
              'fixed inset-y-10 right-10 z-infinity mt-auto mb-0 box-border max-h-[min(calc(100vh_-60px),_1000px)] min-h-[375px] font-sans',
              { 'transition-transform': isAnimationComplete }
            )
          : 'contents'
      }
    >
      <AnimatePresence onExitComplete={() => !open && setPanelPositioned(false)}>
        {open && (
          <motion.div
            data-webchat-panel
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.3, ease: 'linear' }}
            onAnimationEnd={() => setIsAnimationComplete(true)}
            onAnimationStart={() => setIsAnimationComplete(false)}
            className={cn(
              'absolute inset-0 grid grid-flow-col grid-rows-[auto_1fr_auto] rounded-xl bg-slate-50 shadow-2xl dark:bg-slate-950',
              className
            )}
          >
            {memoizedChildren}
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
      {toaster}
    </div>
  )
}

const AppMain: FC<AppMainProps> = (props) => {
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const open = useRemeshQuery(appStatusDomain.query.OpenQuery())
  const position = useRemeshQuery(appStatusDomain.query.PositionQuery())

  return <AppMainFrame {...props} open={open} position={position} />
}

AppMain.displayName = 'AppMain'

export default AppMain
