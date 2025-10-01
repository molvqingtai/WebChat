import { type FC, useMemo } from 'react'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'

import MessageList from '../../components/message-list'
import MessageItem from '../../components/message-item'
import PromptItem from '../../components/prompt-item'
import UserInfoDomain from '@/domain/UserInfo'
import ChatRoomDomain from '@/domain/ChatRoom'
import MessageListDomain from '@/domain/MessageList'
import useDataId from '@/hooks/useDataId'
import { ChatRoomMessageType } from '@/protocol'

const Main: FC = () => {
  const send = useRemeshSend()
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  const _messageList = useRemeshQuery(messageListDomain.query.ListQuery())

  const messageListId = useDataId(_messageList)

  const messageList = useMemo(
    () =>
      _messageList
        .map((message) => {
          if (message.type === ChatRoomMessageType.Normal) {
            return {
              ...message,
              like: message.likeUsers.some((likeUser) => likeUser.userId === userInfo?.id),
              hate: message.hateUsers.some((hateUser) => hateUser.userId === userInfo?.id)
            }
          }
          return message
        })
        .toSorted((a, b) => a.sendTime - b.sendTime),
    [messageListId, userInfo?.id]
  )

  const handleLikeChange = (messageId: string) => {
    send(chatRoomDomain.command.SendLikeMessageCommand(messageId))
  }

  const handleHateChange = (messageId: string) => {
    send(chatRoomDomain.command.SendHateMessageCommand(messageId))
  }

  return (
    <MessageList>
      {messageList.map((message, index) =>
        message.type === ChatRoomMessageType.Normal ? (
          <MessageItem
            key={message.id}
            data={message}
            like={message.like}
            hate={message.hate}
            onLikeChange={() => handleLikeChange(message.id)}
            onHateChange={() => handleHateChange(message.id)}
            className="duration-300 animate-in fade-in-0"
          ></MessageItem>
        ) : (
          <PromptItem
            key={message.id}
            data={message}
            className={`${index === 0 ? 'pt-4' : ''} ${index === messageList.length - 1 ? 'pb-4' : ''}`}
          ></PromptItem>
        )
      )}
    </MessageList>
  )
}

Main.displayName = 'Main'

export default Main
