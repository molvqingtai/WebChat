import { Avatar, AvatarFallback } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { APP_STATUS_STORAGE_KEY } from '@/constants/config'
import { EVENT } from '@/constants/event'
import { AppStatus } from '@/domain/AppStatus'
import { LocalStorageImpl } from '@/domain/impls/Storage'
import { TextMessage } from '@/domain/Room'
import { cn } from '@/utils'
import { AvatarImage } from '@radix-ui/react-avatar'
import { FC, MouseEvent } from 'react'

export interface PromptItemProps {
  data: TextMessage
  className?: string
  onMouseEnter?: (e: MouseEvent<HTMLButtonElement>) => void
  onMouseLeave?: (e: MouseEvent<HTMLButtonElement>) => void
}

const DanmakuMessage: FC<PromptItemProps> = ({ data, className, onMouseEnter, onMouseLeave }) => {
  const handleOpenApp = async () => {
    const appStatus = await LocalStorageImpl.value.get<AppStatus>(APP_STATUS_STORAGE_KEY)
    LocalStorageImpl.value.set<AppStatus>(APP_STATUS_STORAGE_KEY, { ...appStatus!, open: true, unread: 0 })
    dispatchEvent(new CustomEvent(EVENT.APP_OPEN))
  }

  return (
    <Button
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={handleOpenApp}
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
