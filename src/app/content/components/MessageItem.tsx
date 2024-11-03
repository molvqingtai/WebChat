import { type FC } from 'react'
import { FrownIcon, ThumbsUpIcon } from 'lucide-react'
import LikeButton from './LikeButton'
import FormatDate from './FormatDate'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar'

import { Markdown } from '@/components/Markdown'
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

  let content = props.data.body

  // Check if the field exists, compatible with old data
  if (props.data.atUsers) {
    const atUserPositions = props.data.atUsers.flatMap((user) =>
      user.positions.map((position) => ({ username: user.username, userId: user.userId, position }))
    )

    // Replace from back to front according to position to avoid affecting previous indices
    atUserPositions
      .sort((a, b) => b.position[0] - a.position[0])
      .forEach(({ position, username }) => {
        const [start, end] = position
        content = `${content.slice(0, start)} **@${username}** ${content.slice(end + 1)}`
      })
  }

  return (
    <div
      data-index={props.index}
      className={cn(
        'box-border grid grid-cols-[auto_1fr] gap-x-2 px-4  first:pt-4 last:pb-4 dark:text-slate-50',
        props.className
      )}
    >
      <Avatar>
        <AvatarImage src={props.data.userAvatar} className="size-full" alt="avatar" />
        <AvatarFallback>{props.data.username.at(0)}</AvatarFallback>
      </Avatar>
      <div className="overflow-hidden">
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 leading-none">
          <div className="truncate text-sm font-semibold text-slate-600 dark:text-slate-50">{props.data.username}</div>
          <FormatDate className="text-xs text-slate-400 dark:text-slate-100" date={props.data.sendTime}></FormatDate>
        </div>
        <div>
          <div className="pb-2">
            <Markdown>{content}</Markdown>
          </div>
          <div className="grid grid-flow-col justify-end gap-x-2 leading-none dark:text-slate-600">
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
