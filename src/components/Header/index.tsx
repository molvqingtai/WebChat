import { useState, type FC } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/HoverCard'
import { Button } from '@/components/ui/Button'
import getWebSiteInfo from '@/utils/getWebsiteInfo'

const Header: FC = ({ ...props }) => {
  const [websiteInfo] = useState(getWebSiteInfo())

  return (
    <div className="flex h-12  items-center px-4 shadow-sm 2xl:h-14">
      <img className="h-8 w-8 overflow-hidden rounded-full" src={websiteInfo.icon} />
      <HoverCard>
        <HoverCardTrigger asChild>
          <Button className="overflow-hidden text-xl" variant="link">
            <h1 className="truncate">{websiteInfo.hostname}</h1>
          </Button>
        </HoverCardTrigger>
        <HoverCardContent className="w-80">
          <div className="flex justify-between space-x-4">
            <img className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-full" src={websiteInfo.icon} />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">{websiteInfo.title}</h4>
              <p className="text-xs text-slate-500">{websiteInfo.description}</p>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
      <div className="ml-auto flex-shrink-0 text-sm text-slate-500">Online 99</div>
    </div>
  )
}

Header.displayName = 'Header'

export default Header
