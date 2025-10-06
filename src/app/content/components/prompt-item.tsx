import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import type { SystemPromptMessage } from '@/domain/MessageList'
import { cn } from '@/utils'
import { AvatarImage } from '@radix-ui/react-avatar'
import { type FC, memo } from 'react'

export interface PromptItemProps {
  data: SystemPromptMessage
  className?: string
}

const PromptItem: FC<PromptItemProps> = memo(({ data, className }) => {
  return (
    <div className={cn('flex justify-center py-1 px-4 ', className)}>
      <Badge variant="secondary" className="gap-x-2 rounded-full px-2 font-medium text-slate-400 dark:bg-slate-800">
        <Avatar className="size-4">
          <AvatarImage src={data.sender.avatar} className="size-full" alt="avatar" />
          <AvatarFallback>{data.sender.name.at(0)}</AvatarFallback>
        </Avatar>
        {data.body}
      </Badge>
    </div>
  )
})

PromptItem.displayName = 'PromptItem'

export default PromptItem
