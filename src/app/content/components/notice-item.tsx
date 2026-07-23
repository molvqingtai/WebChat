import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import type { SystemNoticeMessage } from '@/domain/MessageList'
import { cn } from '@/utils'
import { AvatarImage } from '@radix-ui/react-avatar'
import { type FC, memo } from 'react'

export interface NoticeItemProps {
  data: SystemNoticeMessage
  className?: string
}

const NoticeItem: FC<NoticeItemProps> = memo(({ data, className }) => {
  return (
    <div className={cn('flex justify-center py-1 px-4 ', className)}>
      <Badge variant="secondary" className="gap-x-2 rounded-full px-2 font-medium text-slate-400 dark:bg-slate-800">
        <Avatar className="size-4">
          <AvatarImage src={data.user.avatar} className="size-full" alt="avatar" />
          <AvatarFallback>{data.user.name.at(0)}</AvatarFallback>
        </Avatar>
        {data.body}
      </Badge>
    </div>
  )
})

NoticeItem.displayName = 'NoticeItem'

export default NoticeItem
