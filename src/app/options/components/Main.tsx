import { type ReactNode, type FC } from 'react'

export interface AppLayoutProps {
  children?: ReactNode
}

const Main: FC<AppLayoutProps> = ({ children }) => {
  return (
    <main className="grid min-h-screen min-w-screen items-center justify-center bg-gray-50 bg-[url(@/assets/images/texture.png)] font-sans">
      <div className="relative rounded-xl bg-slate-50 shadow-lg">{children}</div>
    </main>
  )
}

Main.displayName = 'Main'

export default Main
