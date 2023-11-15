import { type FC } from 'react'
import { Globe2Icon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/Avatar'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/HoverCard'
import { Button } from '@/components/ui/Button'
import { getWebSiteInfo } from '@/utils'

const Header: FC = () => {
  const websiteInfo = getWebSiteInfo()

  return (
    <div className="z-10 grid h-12 grid-flow-col items-center justify-between gap-x-4 rounded-t-xl bg-white px-4 backdrop-blur-lg">
      <Avatar className="h-8 w-8">
        <AvatarImage src={websiteInfo.icon} alt="favicon" />
        <AvatarFallback>
          <Globe2Icon size="100%" className="text-gray-500" />
        </AvatarFallback>
      </Avatar>
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
            <Avatar className="h-14 w-14">
              <AvatarImage src={websiteInfo.icon} alt="favicon" />
              <AvatarFallback>
                <Globe2Icon size="100%" className="text-gray-500" />
              </AvatarFallback>
            </Avatar>
            <div className="grid items-center">
              <h4 className="truncate text-sm font-semibold">{websiteInfo.title}</h4>
              {websiteInfo.description && (
                <p className="line-clamp-2 max-h-8 text-xs text-slate-500">{websiteInfo.description}</p>
              )}
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
