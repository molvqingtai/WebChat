import { type ReactNode, type FC } from 'react'
import useResizable from '@/hooks/useResizable'
import { motion, AnimatePresence } from 'framer-motion'
import AppStatusDomain from '@/domain/AppStatus'
import { useRemeshDomain, useRemeshQuery } from 'remesh-react'

export interface AppContainerProps {
  children?: ReactNode
}

const AppContainer: FC<AppContainerProps> = ({ children }) => {
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const appOpenStatus = useRemeshQuery(appStatusDomain.query.OpenQuery())

  const { size, ref } = useResizable({
    initSize: Math.max(375, window.innerWidth / 6),
    maxSize: Math.min(750, window.innerWidth / 3),
    minSize: Math.max(375, window.innerWidth / 6),
    direction: 'left'
  })

  return (
    <AnimatePresence>
      {appOpenStatus && (
        <motion.div
          initial={{ opacity: 0, y: 10, x: 10 }}
          animate={{ opacity: 1, y: 0, x: 0 }}
          exit={{ opacity: 0, y: 10, x: 10 }}
          transition={{ duration: 0.3 }}
          style={{
            width: `${size}px`
          }}
          className="fixed bottom-10 right-10 z-infinity box-border grid h-screen max-h-[min(calc(100vh_-60px),_1200px)] grid-flow-col grid-rows-[auto_1fr_auto] rounded-xl bg-slate-50 font-sans shadow-2xl"
        >
          {children}
          <div
            ref={ref}
            className="absolute inset-y-3 -left-0.5 z-20 w-1 cursor-ew-resize rounded-xl bg-slate-100 opacity-0 shadow transition-opacity duration-200 ease-in hover:opacity-100"
          ></div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

AppContainer.displayName = 'AppContainer'

export default AppContainer
