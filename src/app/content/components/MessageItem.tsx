import { type FC } from 'react'
import { FrownIcon, HeartIcon, LanguagesIcon, LoaderCircleIcon } from 'lucide-react'
import LikeButton from './LikeButton'
import FormatDate from './FormatDate'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar'

import { Markdown } from '@/components/Markdown'
import { type NormalMessage } from '@/domain/MessageList'
import { cn } from '@/utils'
import { Button } from '@/components/ui/Button'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import ChatRoomDomain from '@/domain/ChatRoom'
import TranslateListDomain from '@/domain/TranslateList'
import UserInfoDomain from '@/domain/UserInfo'

export interface MessageItemProps {
  data: NormalMessage
  index?: number
  className?: string
}

const MessageItem: FC<MessageItemProps> = ({ data, index, className }) => {
  const send = useRemeshSend()
  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const translateListDomain = useRemeshDomain(TranslateListDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  const translateData = useRemeshQuery(translateListDomain.query.ItemQuery(data.id))
  const translateTask = useRemeshQuery(translateListDomain.query.TaskQuery(data.id))

  console.log('translateTask', translateTask)

  const liked = data.likeUsers.some((likeUser) => likeUser.userId === userInfo?.id)
  const hated = data.hateUsers.some((hateUser) => hateUser.userId === userInfo?.id)

  let content = data.body

  // Check if the field exists, compatible with old data
  if (data.atUsers) {
    const atUserPositions = data.atUsers.flatMap((user) =>
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

  const handleLikeChange = () => {
    send(chatRoomDomain.command.SendLikeMessageCommand(data.id))
  }

  const handleHateChange = () => {
    send(chatRoomDomain.command.SendHateMessageCommand(data.id))
  }

  const handleTranslate = () => {
    send(translateListDomain.command.TranslateCommand(data.id))
  }

  return (
    <div
      data-index={index}
      className={cn(
        'box-border grid grid-cols-[auto_1fr] gap-x-2 px-4 first:pt-4 last:pb-4 dark:text-slate-50',
        className
      )}
    >
      <Avatar>
        <AvatarImage src={data.userAvatar} className="size-full" alt="avatar" />
        <AvatarFallback>{data.username.at(0)}</AvatarFallback>
      </Avatar>
      <div className="overflow-hidden">
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 leading-none">
          <div className="truncate text-sm font-semibold text-slate-600 dark:text-slate-50">{data.username}</div>
          <FormatDate className="text-xs text-slate-400 dark:text-slate-100" date={data.sendTime}></FormatDate>
        </div>
        <div>
          <div className="pb-2">
            <Markdown>{content}</Markdown>
            {translateData?.targetBody && (
              <div className="border-t border-slate-200 opacity-70 dark:border-slate-700">
                <Markdown>{translateData?.targetBody}</Markdown>
              </div>
            )}
          </div>
          <div className="flex gap-x-2 leading-none dark:text-slate-600">
            {!translateData?.targetBody && (
              <Button
                variant="secondary"
                disabled={translateTask?.status === 'loading'}
                onClick={handleTranslate}
                className={cn(
                  'flex gap-x-1 items-center overflow-hidden rounded-full leading-none transition-all select-none dark:bg-slate-800  text-slate-500 dark:text-slate-200',
                  translateTask?.status === 'loading' && 'disabled:opacity-100'
                )}
                size="xs"
              >
                {translateTask?.status === 'loading' ? (
                  <LoaderCircleIcon className="animate-spin" size={14}></LoaderCircleIcon>
                ) : (
                  <LanguagesIcon size={14}></LanguagesIcon>
                )}
                Translate
              </Button>
            )}
            <LikeButton className="ml-auto" checked={liked} onChange={handleLikeChange} count={data.likeUsers.length}>
              <LikeButton.Icon>
                <HeartIcon size={14}></HeartIcon>
              </LikeButton.Icon>
            </LikeButton>
            <LikeButton checked={hated} onChange={handleHateChange} count={data.hateUsers.length}>
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
