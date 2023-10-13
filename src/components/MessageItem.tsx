import { type FC, useState } from 'react'
import { format } from 'date-fns'
import { FrownIcon, ThumbsUpIcon } from 'lucide-react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar'

import LikeButton from '@/components/LikeButton'
import { type Message } from '@/types'
import { Markdown } from '@/components/ui/Markdown'

export interface MessageItemProps {
  data: Message
}

const MessageItem: FC<MessageItemProps> = ({ data }) => {
  const [formatData, setFormatData] = useState({
    ...data,
    date: format(data.date, 'yyyy/MM/dd HH:mm:ss')
  })

  const handleLikeChange = (type: 'like' | 'hate', checked: boolean, count: number) => {
    setFormatData((prev) => {
      return {
        ...prev,
        [`${type}Checked`]: checked,
        [`${type}Count`]: count
      }
    })
  }

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-2 px-4 first:pt-4 last:pb-4">
      <Avatar>
        <AvatarImage src={formatData.avatar} />
        <AvatarFallback>{formatData.username}</AvatarFallback>
      </Avatar>
      <div className="grid">
        <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 leading-none">
          <div className="text-sm font-medium text-slate-600">{formatData.username}</div>
          <div className="text-xs text-slate-400">{formatData.date}</div>
        </div>
        <div>
          <div className="pb-2">
            <Markdown>{formatData.body}</Markdown>
          </div>
          <div className="grid grid-flow-col justify-end gap-x-2 leading-none">
            <LikeButton
              checked={formatData.likeChecked}
              onChange={(...args) => handleLikeChange('like', ...args)}
              count={formatData.likeCount}
            >
              <LikeButton.Icon>
                <ThumbsUpIcon size={14}></ThumbsUpIcon>
              </LikeButton.Icon>
            </LikeButton>
            <LikeButton
              checked={formatData.hateChecked}
              onChange={(...args) => handleLikeChange('hate', ...args)}
              count={formatData.hateCount}
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
