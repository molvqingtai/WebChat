import { type FC, useState } from 'react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar'
import { format } from 'date-fns'

import LikeButton from './LikeButton'
export interface MessageProps {
  data: {
    id: string
    body: string
    username: string
    avatar: string
    date: number
    likeChecked: boolean
    hateChecked: boolean
    likeCount: number
    hateCount: number
  }
}

const Message: FC<MessageProps> = ({ data }) => {
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
    <div className="grid grid-cols-[auto_1fr] gap-x-2">
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
            <pre className="text-sm">{formatData.body}</pre>
          </div>
          <div className="grid grid-flow-col justify-end gap-x-2 leading-none">
            <LikeButton
              type="like"
              checked={formatData.likeChecked}
              onChange={(...args) => handleLikeChange('like', ...args)}
              count={formatData.likeCount}
            ></LikeButton>
            <LikeButton
              type="hate"
              checked={formatData.hateChecked}
              onChange={(...args) => handleLikeChange('hate', ...args)}
              count={formatData.hateCount}
            ></LikeButton>
          </div>
        </div>
      </div>
    </div>
  )
}

Message.displayName = 'Message'

export default Message
