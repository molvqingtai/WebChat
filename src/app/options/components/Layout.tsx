import Meteors from '@/components/magicui/Meteors'
import { FC, ReactNode } from 'react'

export interface LayoutProps {
  children?: ReactNode
}

const Layout: FC<LayoutProps> = ({ children }) => {
  return (
    <div className={`h-screen w-screen bg-gray-50 bg-[url(@/assets/images/texture.png)] font-sans dark:bg-slate-950`}>
      <div className="fixed left-0 top-0 h-full w-screen overflow-hidden">
        <Meteors number={30} />
      </div>
      <div className="relative z-10 min-h-screen min-w-screen">{children}</div>
    </div>
  )
}

Layout.displayName = 'Layout'
export default Layout
