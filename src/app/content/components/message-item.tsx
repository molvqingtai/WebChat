import { type FC, memo } from 'react'
import { FrownIcon, HeartIcon } from 'lucide-react'
import LikeButton from './like-button'
import FormatDate from './format-date'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'

import { Markdown } from '@/components/markdown'
import { type TextMessage } from '@/domain/MessageList'
import { cn } from '@/utils'

export interface MessageItemProps {
  data: TextMessage
  index?: number
  like: boolean
  hate: boolean
  onLikeChange?: (checked: boolean) => void
  onHateChange?: (checked: boolean) => void
  className?: string
}

const MessageItem: FC<MessageItemProps> = memo((props) => {
  const handleLikeChange = (checked: boolean) => {
    props.onLikeChange?.(checked)
  }
  const handleHateChange = (checked: boolean) => {
    props.onHateChange?.(checked)
  }

  let content = props.data.body

  // Check if mentions exist
  if (props.data.mentions && props.data.mentions.length > 0) {
    const mentionPositions = props.data.mentions.flatMap((user) =>
      user.positions.map((position) => ({ name: user.name, id: user.id, position }))
    )

    // Replace from back to front according to position to avoid affecting previous indices
    mentionPositions
      .sort((a, b) => b.position[0] - a.position[0])
      .forEach(({ position, name }) => {
        const [start, end] = position
        content = `${content.slice(0, start)} **@${name}** ${content.slice(end + 1)}`
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
        <AvatarImage src={props.data.sender.avatar} className="size-full" alt="avatar" />
        <AvatarFallback>{props.data.sender.name.at(0)}</AvatarFallback>
      </Avatar>
      <div className="overflow-hidden">
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 leading-none">
          <div className="truncate text-sm font-semibold text-slate-600 dark:text-slate-50">
            {props.data.sender.name}
          </div>
          <FormatDate className="text-xs text-slate-400 dark:text-slate-100" date={props.data.sentAt}></FormatDate>
        </div>
        <div>
          <div className="pb-2">
            <Markdown>{content}</Markdown>
          </div>
          <div className="grid grid-flow-col justify-end gap-x-2 leading-none dark:text-slate-600">
            <LikeButton
              checked={props.like}
              onChange={(checked) => handleLikeChange(checked)}
              count={props.data.reactions.likes.length}
            >
              <LikeButton.Icon>
                <HeartIcon size={14}></HeartIcon>
              </LikeButton.Icon>
            </LikeButton>
            <LikeButton
              checked={props.hate}
              onChange={(checked) => handleHateChange(checked)}
              count={props.data.reactions.hates.length}
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
})

MessageItem.displayName = 'MessageItem'

export default MessageItem
