import { Avatar, AvatarFallback } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { TextMessage } from '@/domain/Room'
import { cn } from '@/utils'
import { AvatarImage } from '@radix-ui/react-avatar'
import { FC } from 'react'

export interface PromptItemProps {
  data: TextMessage
  className?: string
}

const DanmakuMessage: FC<PromptItemProps> = ({ data, className }) => {
  return (
    <Button
      className={cn(
        'flex justify-center pointer-events-auto visible gap-x-2 border px-2.5 py-0.5  rounded-full bg-primary/30 text-base font-medium text-white backdrop-blur-md',
        className
      )}
    >
      <Avatar className="size-5">
        <AvatarImage src={data.userAvatar} alt="avatar" />
        <AvatarFallback>{data.username.at(0)}</AvatarFallback>
      </Avatar>
      <div className="max-w-40 overflow-hidden text-ellipsis">{data.body}</div>
    </Button>
  )
}

DanmakuMessage.displayName = 'DanmakuMessage'

export default DanmakuMessage
