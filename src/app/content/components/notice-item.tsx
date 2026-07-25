import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import type { SystemNoticeMessage } from '@/domain/MessageList'
import { cn } from '@/utils'
import { AvatarImage } from '@radix-ui/react-avatar'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { type FC, memo } from 'react'

export interface NoticeItemProps {
  data: SystemNoticeMessage
  count?: number
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  className?: string
}

const NoticeItem: FC<NoticeItemProps> = memo(({ data, count, expanded = false, onExpandedChange, className }) => {
  return (
    <div className={cn('flex justify-center py-1 px-4 ', className)}>
      <Badge variant="secondary" className="gap-x-2 rounded-full px-2 font-medium text-slate-400 dark:bg-slate-800">
        <Avatar className="size-4">
          <AvatarImage src={data.user.avatar} className="size-full" alt="avatar" />
          <AvatarFallback>{data.user.name.at(0)}</AvatarFallback>
        </Avatar>
        <span>{data.body}</span>
        {count && count > 1 ? <span className="text-slate-500 tabular-nums dark:text-slate-300">{count}</span> : null}
        {onExpandedChange ? (
          <button
            type="button"
            aria-label={expanded ? 'Collapse notices' : 'Expand notices'}
            aria-expanded={expanded}
            title={expanded ? 'Collapse notices' : 'Expand notices'}
            className="grid size-5 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none dark:text-slate-300 dark:hover:bg-slate-700"
            onClick={() => onExpandedChange(!expanded)}
          >
            {expanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
          </button>
        ) : null}
      </Badge>
    </div>
  )
})

NoticeItem.displayName = 'NoticeItem'

export default NoticeItem
