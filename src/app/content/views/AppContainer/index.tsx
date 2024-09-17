import { type ReactNode, type FC } from 'react'
import useResizable from '@/hooks/useResizable'
import useBreakpoint from '@/hooks/useBreakpoint'
export interface AppContainerProps {
  children?: ReactNode
}

const AppContainer: FC<AppContainerProps> = ({ children }) => {
  const { breakpoint } = useBreakpoint()
  console.log(breakpoint)

  const { size, ref } = useResizable({
    initSize: Math.max(375, window.innerWidth / 5),
    maxSize: Math.max(750, window.innerWidth / 3),
    minSize: Math.max(375, window.innerWidth / 5),
    direction: 'left'
  })

  return (
    <div
      style={{
        width: `${size}px`
      }}
      className="fixed bottom-10 right-10 top-5 z-top box-border grid min-h-[375px] grid-flow-col grid-rows-[auto_1fr_auto] rounded-xl bg-slate-50  font-sans shadow-2xl"
    >
      {children}
      <div
        ref={ref}
        className="absolute inset-y-3 -left-0.5 z-20 w-1 cursor-ew-resize rounded-sm bg-slate-100 opacity-0 shadow transition-opacity duration-200 ease-in hover:opacity-100"
      ></div>
    </div>
  )
}

AppContainer.displayName = 'AppContainer'

export default AppContainer
