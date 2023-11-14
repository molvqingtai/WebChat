import { type FC } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/HoverCard'
import { Button } from '@/components/ui/Button'
import { getWebSiteInfo } from '@/utils'

const Header: FC = () => {
  const websiteInfo = getWebSiteInfo()

  return (
    <div className="z-10 grid h-12 grid-flow-col items-center justify-between gap-x-4 rounded-t-xl bg-white px-4 backdrop-blur-lg 2xl:h-14">
      <img className="h-8 w-8 overflow-hidden rounded-full" src={websiteInfo.icon} />
      <HoverCard>
        <HoverCardTrigger asChild>
          <Button className="overflow-hidden" variant="link">
            <span className="truncate text-lg font-medium text-slate-600">
              {websiteInfo.hostname.replace(/^www\./i, '')}
            </span>
          </Button>
        </HoverCardTrigger>
        <HoverCardContent className="w-80">
          <div className="grid grid-cols-[auto_1fr] gap-x-4">
            <img className="h-14 w-14 overflow-hidden rounded-full" src={websiteInfo.icon} />
            <div className="grid items-center">
              <h4 className="truncate text-sm font-semibold">{websiteInfo.title}</h4>
              <p className="line-clamp-2 max-h-8 text-xs text-slate-500">{websiteInfo.description}</p>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
      <div className="text-sm text-slate-500">Online 99</div>
    </div>
  )
}

Header.displayName = 'Header'

export default Header
