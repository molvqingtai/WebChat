import { type FC, useMemo } from 'react'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'

import MessageList from '../../components/message-list'
import MessageItem from '../../components/message-item'
import NoticeItem from '../../components/notice-item'
import UserInfoDomain from '@/domain/UserInfo'
import ChatRoomDomain from '@/domain/ChatRoom'
import MessageListDomain from '@/domain/MessageList'
import { compareEventPosition } from '@/domain/Message'

const Main: FC = () => {
  const send = useRemeshSend()
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  const _messageList = useRemeshQuery(messageListDomain.query.ListQuery())

  const messageList = useMemo(
    () =>
      _messageList
        .map((message) => {
          if (message.type === 'text') {
            return {
              ...message,
              like: message.reactions.likes.some((likeUser) => likeUser.id === userInfo?.id),
              hate: message.reactions.hates.some((hateUser) => hateUser.id === userInfo?.id)
            }
          }
          return message
        })
        .toSorted(compareEventPosition),
    [_messageList, userInfo?.id]
  )

  const handleLikeChange = (messageId: string) => {
    send(chatRoomDomain.command.SendReactionCommand({ messageId, reaction: 'like' }))
  }

  const handleHateChange = (messageId: string) => {
    send(chatRoomDomain.command.SendReactionCommand({ messageId, reaction: 'hate' }))
  }

  return (
    <MessageList>
      {messageList.map((message, index) =>
        message.type === 'text' ? (
          <MessageItem
            key={message.id}
            data={message}
            like={message.like}
            hate={message.hate}
            onLikeChange={() => handleLikeChange(message.id)}
            onHateChange={() => handleHateChange(message.id)}
            className="animate-in fade-in-0 duration-300"
          ></MessageItem>
        ) : (
          <NoticeItem
            key={message.id}
            data={message}
            className={`${index === 0 ? 'pt-4' : ''} ${index === messageList.length - 1 ? 'pb-4' : ''}`}
          ></NoticeItem>
        )
      )}
    </MessageList>
  )
}

Main.displayName = 'Main'

export default Main
