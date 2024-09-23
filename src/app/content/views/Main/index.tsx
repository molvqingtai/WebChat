import { type FC } from 'react'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'

import MessageList from '../../components/MessageList'
import MessageItem from '../../components/MessageItem'
import PromptItem from '../../components/PromptItem'
import UserInfoDomain from '@/domain/UserInfo'
import RoomDomain, { MessageType } from '@/domain/Room'

const Main: FC = () => {
  const send = useRemeshSend()
  const roomDomain = useRemeshDomain(RoomDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const _messageList = useRemeshQuery(roomDomain.query.MessageListQuery())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  const messageList = _messageList.map((message) => {
    if (message.type === MessageType.Normal) {
      return {
        ...message,
        like: message.likeUsers.some((likeUser) => likeUser.userId === userInfo?.id),
        hate: message.hateUsers.some((hateUser) => hateUser.userId === userInfo?.id)
      }
    }
    return message
  })

  const handleLikeChange = (messageId: string) => {
    send(roomDomain.command.SendLikeMessageCommand(messageId))
  }

  const handleHateChange = (messageId: string) => {
    send(roomDomain.command.SendHateMessageCommand(messageId))
  }

  return (
    <MessageList>
      {messageList.map((message, index) =>
        message.type === MessageType.Normal ? (
          <MessageItem
            key={message.id}
            data={message}
            like={message.like}
            hate={message.hate}
            index={index}
            onLikeChange={() => handleLikeChange(message.id)}
            onHateChange={() => handleHateChange(message.id)}
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
