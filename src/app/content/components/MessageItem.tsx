import { type FC } from 'react'
import { FrownIcon, ThumbsUpIcon } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import LikeButton from './LikeButton'
import FormatDate from './FormatDate'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar'

import { Markdown } from '@/components/ui/Markdown'
import { type NormalMessage } from '@/domain/MessageList'
import { cn } from '@/utils'

export interface MessageItemProps {
  data: NormalMessage
  index?: number
  like: boolean
  hate: boolean
  onLikeChange?: (checked: boolean) => void
  onHateChange?: (checked: boolean) => void
  className?: string
}

const MessageItem: FC<MessageItemProps> = (props) => {
  const handleLikeChange = (checked: boolean) => {
    props.onLikeChange?.(checked)
  }
  const handleHateChange = (checked: boolean) => {
    props.onHateChange?.(checked)
  }
  return (
    <div
      data-index={props.index}
      className={cn('box-border grid grid-cols-[auto_1fr] gap-x-2 px-4  first:pt-4 last:pb-4', props.className)}
    >
      <Avatar>
        <AvatarImage src={props.data.userAvatar} alt="avatar" />
        <AvatarFallback>{props.data.username.at(0)}</AvatarFallback>
      </Avatar>
      <div className="overflow-hidden">
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 leading-none">
          <div className="overflow-hidden text-ellipsis text-sm font-semibold text-slate-600">
            {props.data.username}
          </div>
          <FormatDate className="text-xs text-slate-400" date={props.data.date}></FormatDate>
        </div>
        <div>
          <div className="pb-2">
            <Markdown>{props.data.body}</Markdown>
          </div>
          <div className="grid grid-flow-col justify-end gap-x-2 leading-none">
            <LikeButton
              checked={props.like}
              onChange={(checked) => handleLikeChange(checked)}
              count={props.data.likeUsers.length}
            >
              <LikeButton.Icon>
                <ThumbsUpIcon size={14}></ThumbsUpIcon>
              </LikeButton.Icon>
            </LikeButton>
            <LikeButton
              checked={props.hate}
              onChange={(checked) => handleHateChange(checked)}
              count={props.data.hateUsers.length}
            >
              <LikeButton.Icon>
                <FrownIcon size={14}></FrownIcon>
              </LikeButton.Icon>
            </LikeButton>
          </div>
        </div>
      </div>
    </div>
  )
}

MessageItem.displayName = 'MessageItem'

export default MessageItem
