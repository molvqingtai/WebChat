import { type ReactNode, type FC } from 'react'

export interface AppContainerProps {
  children?: ReactNode
}

const AppContainer: FC<AppContainerProps> = ({ children }) => {
  return (
    <div className="fixed bottom-10 right-10 top-10 z-top box-border grid w-1/4 grid-flow-col grid-rows-[auto_1fr_auto]  overflow-hidden rounded-xl bg-white shadow-2xl transition-transform">
      {children}
    </div>
  )
}

AppContainer.displayName = 'AppContainer'

export default AppContainer
