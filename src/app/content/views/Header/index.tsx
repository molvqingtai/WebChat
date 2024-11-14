import { useState, type FC } from 'react'
import { Globe2Icon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/Avatar'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/HoverCard'
import { Button } from '@/components/ui/Button'
import { cn, getSiteInfo } from '@/utils'
import { useRemeshDomain, useRemeshQuery } from 'remesh-react'
import ChatRoomDomain from '@/domain/ChatRoom'
import VirtualRoomDomain, { FromInfo, RoomUser } from '@/domain/VirtualRoom'
import { ScrollArea } from '@/components/ui/ScrollArea'
import { Virtuoso } from 'react-virtuoso'
import AvatarCircles from '@/components/magicui/AvatarCircles'
import Link from '@/components/Link'

const Header: FC = () => {
  const siteInfo = getSiteInfo()
  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const virtualRoomDomain = useRemeshDomain(VirtualRoomDomain())
  const chatUserList = useRemeshQuery(chatRoomDomain.query.UserListQuery())
  const virtualUserList = useRemeshQuery(virtualRoomDomain.query.UserListQuery())
  const chatOnlineCount = chatUserList.length

  const virtualOnlineGroup = virtualUserList
    .flatMap((user) => user.fromInfos.map((from) => ({ from, user })))
    .reduce<(FromInfo & { users: RoomUser[] })[]>((acc, item) => {
      const existSite = acc.find((group) => group.origin === item.from.origin)
      if (existSite) {
        const existUser = existSite.users.find((user) => user.userId === item.user.userId)
        !existUser && existSite.users.push(item.user)
      } else {
        acc.push({ ...item.from, users: [item.user] })
      }
      return acc
    }, [])
    .sort((a, b) => b.users.length - a.users.length)

  const [chatUserListScrollParentRef, setChatUserListScrollParentRef] = useState<HTMLDivElement | null>(null)
  const [virtualOnlineGroupScrollParentRef, setVirtualOnlineGroupScrollParentRef] = useState<HTMLDivElement | null>(
    null
  )

  return (
    <div className="z-10 grid h-12 grid-flow-col grid-cols-[theme('spacing.20')_auto_theme('spacing.20')] items-center justify-between rounded-t-xl bg-white px-4 backdrop-blur-lg dark:bg-slate-950">
      <Avatar className="size-8 rounded-sm">
        <AvatarImage src={siteInfo.icon} alt="favicon" />
        <AvatarFallback>
          <Globe2Icon size="100%" className="text-gray-400" />
        </AvatarFallback>
      </Avatar>
      <HoverCard>
        <HoverCardTrigger asChild>
          <Button className="overflow-hidden p-2" variant="link">
            <span className="truncate text-lg font-semibold text-slate-600 dark:text-slate-50">
              {siteInfo.hostname.replace(/^www\./i, '')}
            </span>
          </Button>
        </HoverCardTrigger>
        <HoverCardContent className="w-80 rounded-lg p-0">
          <ScrollArea className="max-h-96 min-h-[72px] p-2" ref={setVirtualOnlineGroupScrollParentRef}>
            <Virtuoso
              data={virtualOnlineGroup}
              defaultItemHeight={56}
              customScrollParent={virtualOnlineGroupScrollParentRef!}
              itemContent={(_index, site) => (
                <Link
                  underline={false}
                  href={site.origin}
                  className="grid cursor-pointer grid-cols-[auto_1fr] items-center gap-x-2 rounded-lg px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
                >
                  <Avatar className="size-10 rounded-sm">
                    <AvatarImage src={site.icon} alt="favicon" />
                    <AvatarFallback>
                      <Globe2Icon size="100%" className="text-gray-400" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid items-center">
                    <div className="flex items-center gap-x-1 overflow-hidden">
                      <h4 className="flex-1 truncate text-sm font-semibold">{site.hostname.replace(/^www\./i, '')}</h4>
                      <div className="shrink-0 text-sm">
                        <div className="flex items-center gap-x-1 text-nowrap text-xs text-slate-500">
                          <span className="relative flex size-2">
                            <span
                              className={cn(
                                'absolute inline-flex size-full animate-ping rounded-full opacity-75',
                                site.users.length > 1 ? 'bg-green-400' : 'bg-orange-400'
                              )}
                            ></span>
                            <span
                              className={cn(
                                'relative inline-flex size-full rounded-full',
                                site.users.length > 1 ? 'bg-green-500' : 'bg-orange-500'
                              )}
                            ></span>
                          </span>
                          <span className="dark:text-slate-50">
                            ONLINE {site.users.length > 99 ? '99+' : site.users.length}
                          </span>
                        </div>
                      </div>
                    </div>
                    <AvatarCircles max={9} size="xs" avatarUrls={site.users.map((user) => user.userAvatar)} />
                  </div>
                </Link>
              )}
            ></Virtuoso>
          </ScrollArea>
        </HoverCardContent>
      </HoverCard>
      <HoverCard>
        <HoverCardTrigger asChild>
          <Button className="p-0" variant="link">
            <div className="flex items-center gap-x-1 text-nowrap text-xs text-slate-500">
              <span className="relative flex size-2">
                <span
                  className={cn(
                    'absolute inline-flex size-full animate-ping rounded-full opacity-75',
                    chatOnlineCount > 1 ? 'bg-green-400' : 'bg-orange-400'
                  )}
                ></span>
                <span
                  className={cn(
                    'relative inline-flex size-full rounded-full',
                    chatOnlineCount > 1 ? 'bg-green-500' : 'bg-orange-500'
                  )}
                ></span>
              </span>
              <span className="dark:text-slate-50">ONLINE {chatOnlineCount > 99 ? '99+' : chatOnlineCount}</span>
            </div>
          </Button>
        </HoverCardTrigger>
        <HoverCardContent className="w-36 rounded-lg p-0">
          <ScrollArea className="max-h-[204px] min-h-9 p-1" ref={setChatUserListScrollParentRef}>
            <Virtuoso
              data={chatUserList}
              defaultItemHeight={28}
              customScrollParent={chatUserListScrollParentRef!}
              itemContent={(_index, user) => (
                <div className={cn('flex  items-center gap-x-2 rounded-md px-2 py-1.5 outline-none')}>
                  <Avatar className="size-4 shrink-0">
                    <AvatarImage className="size-full" src={user.userAvatar} alt="avatar" />
                    <AvatarFallback>{user.username.at(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 truncate text-xs text-slate-500 dark:text-slate-50">{user.username}</div>
                </div>
              )}
            ></Virtuoso>
          </ScrollArea>
        </HoverCardContent>
      </HoverCard>
    </div>
  )
}

Header.displayName = 'Header'

export default Header
