import { type FC, useMemo } from 'react'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'

import MessageList from '../../components/message-list'
import MessageItem from '../../components/message-item'
import NoticeGroup from '../../components/notice-group'
import { groupAdjacentNotices, messageRowKey } from '../../components/notice-grouping'
import NoticeItem from '../../components/notice-item'
import UserInfoDomain from '@/domain/UserInfo'
import ChatRoomDomain from '@/domain/ChatRoom'
import MessageListDomain from '@/domain/MessageList'
import { compareEventPosition } from '@/domain/Message'

export interface MainProps {
  localSendToken: number
}

const Main: FC<MainProps> = ({ localSendToken }) => {
  const send = useRemeshSend()
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  const _messageList = useRemeshQuery(messageListDomain.query.ListQuery())
  const messageListLoadFinished = useRemeshQuery(messageListDomain.query.LoadIsFinishedQuery())

  const messageList = useMemo(
    () =>
      groupAdjacentNotices(
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
          .toSorted(compareEventPosition)
      ),
    [_messageList, userInfo?.id]
  )

  return (
    <MessageList localSendToken={localSendToken}>
      {messageListLoadFinished
        ? messageList.map((message, index) => {
            const key = messageRowKey(message)
            if (message.type === 'text') {
              return (
                <MessageItem
                  key={key}
                  data={message}
                  like={message.like}
                  hate={message.hate}
                  onToggleLike={() =>
                    send(chatRoomDomain.command.SendReactionCommand({ messageId: message.id, reaction: 'like' }))
                  }
                  onToggleHate={() =>
                    send(chatRoomDomain.command.SendReactionCommand({ messageId: message.id, reaction: 'hate' }))
                  }
                  className="animate-in fade-in-0 duration-300"
                />
              )
            }
            if (message.type === 'notice-group') {
              return (
                <NoticeGroup
                  key={key}
                  notices={message.notices}
                  first={index === 0}
                  last={index === messageList.length - 1}
                />
              )
            }
            return (
              <NoticeItem
                key={key}
                data={message}
                className={`${index === 0 ? 'pt-4' : ''} ${index === messageList.length - 1 ? 'pb-4' : ''}`}
              />
            )
          })
        : null}
    </MessageList>
  )
}

Main.displayName = 'Main'

export default Main
