import { type FC } from 'react'
import { Globe2Icon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/Avatar'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/HoverCard'
import { Button } from '@/components/ui/Button'
import { cn, getSiteInfo } from '@/utils'
import { useRemeshDomain, useRemeshQuery } from 'remesh-react'
import RoomDomain from '@/domain/Room'

const Header: FC = () => {
  const siteInfo = getSiteInfo()
  const roomDomain = useRemeshDomain(RoomDomain())
  const userList = useRemeshQuery(roomDomain.query.UserListQuery())
  const onlineCount = userList.length

  return (
    <div className="z-10 grid h-12 grid-flow-col grid-cols-[theme('spacing.20')_auto_theme('spacing.20')] items-center justify-between rounded-t-xl bg-white px-4 backdrop-blur-lg">
      <Avatar className="size-8">
        <AvatarImage src={siteInfo.icon} alt="favicon" />
        <AvatarFallback>
          <Globe2Icon size="100%" className="text-gray-400" />
        </AvatarFallback>
      </Avatar>
      <HoverCard>
        <HoverCardTrigger asChild>
          <Button className="overflow-hidden" variant="link">
            <span className="truncate text-lg font-semibold text-slate-600">
              {siteInfo.hostname.replace(/^www\./i, '')}
            </span>
          </Button>
        </HoverCardTrigger>
        <HoverCardContent className="w-80">
          <div className="grid grid-cols-[auto_1fr] gap-x-4">
            <Avatar className="size-14">
              <AvatarImage src={siteInfo.icon} alt="favicon" />
              <AvatarFallback>
                <Globe2Icon size="100%" className="text-gray-400" />
              </AvatarFallback>
            </Avatar>
            <div className="grid items-center">
              <h4 className="truncate text-sm font-semibold">{siteInfo.title}</h4>
              {siteInfo.description && (
                <p className="line-clamp-2 max-h-8 text-xs text-slate-500">{siteInfo.description}</p>
              )}
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
      <div className="flex items-center gap-x-1 text-sm text-slate-500">
        <span className="relative flex size-2">
          <span
            className={cn(
              'absolute inline-flex size-full animate-ping rounded-full opacity-75',
              onlineCount > 1 ? 'bg-green-400' : 'bg-orange-400'
            )}
          ></span>
          <span
            className={cn(
              'relative inline-flex size-2 rounded-full',
              onlineCount > 1 ? 'bg-green-500' : 'bg-orange-500'
            )}
          ></span>
        </span>
        <span>ONLINE {onlineCount > 99 ? '99+' : onlineCount}</span>
      </div>
    </div>
  )
}

Header.displayName = 'Header'

export default Header
