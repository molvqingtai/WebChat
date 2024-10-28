import { Avatar, AvatarFallback } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { PromptMessage } from '@/domain/MessageList'
import { cn } from '@/utils'
import { AvatarImage } from '@radix-ui/react-avatar'
import { FC } from 'react'

export interface PromptItemProps {
  data: PromptMessage
  className?: string
}

const PromptItem: FC<PromptItemProps> = ({ data, className }) => {
  return (
    <div className={cn('flex justify-center py-1 px-4 ', className)}>
      <Badge variant="secondary" className="gap-x-2 rounded-full px-2 font-medium text-slate-400 dark:bg-slate-800">
        <Avatar className="size-4">
          <AvatarImage src={data.userAvatar} className="size-full" alt="avatar" />
          <AvatarFallback>{data.username.at(0)}</AvatarFallback>
        </Avatar>
        {data.body}
      </Badge>
    </div>
  )
}

PromptItem.displayName = 'PromptItem'

export default PromptItem
