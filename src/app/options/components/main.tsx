import { type ReactNode, type FC } from 'react'

export interface MainProps {
  children?: ReactNode
}

const Main: FC<MainProps> = ({ children }) => {
  return (
    <main className="grid min-h-screen min-w-screen items-center justify-center">
      <div className="relative rounded-xl bg-slate-50 shadow-lg dark:bg-slate-900 dark:text-slate-50">{children}</div>
    </main>
  )
}

Main.displayName = 'Main'

export default Main
