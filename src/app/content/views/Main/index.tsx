import { useEffect, type FC, useRef } from 'react'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'

import MessageList from '../../components/MessageList'
import MessageItem from '../../components/MessageItem'
import UserInfoDomain from '@/domain/UserInfo'
import RoomDomain from '@/domain/Room'

const Main: FC = () => {
  const send = useRemeshSend()
  const roomDomain = useRemeshDomain(RoomDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const _messageList = useRemeshQuery(roomDomain.query.MessageListQuery())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  const messageList = _messageList.map((message) => ({
    ...message,
    like: message.likeUsers.some((likeUser) => likeUser.userId === userInfo?.id),
    hate: message.hateUsers.some((hateUser) => hateUser.userId === userInfo?.id)
  }))
  const messageListRef = useRef<HTMLDivElement>(null)

  const isUpdate = useRef(false)

  const handleLikeChange = (messageId: string) => {
    send(roomDomain.command.SendLikeMessageCommand(messageId))
  }

  const handleHateChange = (messageId: string) => {
    send(roomDomain.command.SendHateMessageCommand(messageId))
  }

  useEffect(() => {
    const lastMessageRef = messageListRef.current?.querySelector('[data-index]:last-child')
    const timerId = setTimeout(() => {
      requestAnimationFrame(() => {
        lastMessageRef?.scrollIntoView({ behavior: isUpdate.current ? 'smooth' : 'instant', block: 'end' })
        isUpdate.current = true
      })
    }, 0)

    return () => clearTimeout(timerId)
  }, [messageList.length])

  return (
    <MessageList ref={messageListRef}>
      {messageList.map((message, index) => (
        <MessageItem
          key={message.id}
          data={message}
          like={message.like}
          hate={message.hate}
          index={index}
          onLikeChange={() => handleLikeChange(message.id)}
          onHateChange={() => handleHateChange(message.id)}
        ></MessageItem>
      ))}
    </MessageList>
  )
}

Main.displayName = 'Main'

export default Main
