import { type FC } from 'react'
import { useRemeshDomain, useRemeshQuery } from 'remesh-react'

import MessageList from '../../components/MessageList'
import MessageItem from '../../components/MessageItem'
import PromptItem from '../../components/PromptItem'
import MessageListDomain, { MessageType } from '@/domain/MessageList'
import { cn } from '@/utils'

const Main: FC = () => {
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const messageList = useRemeshQuery(messageListDomain.query.ListQuery())

  return (
    <MessageList>
      {messageList.map((message, index) =>
        message.type === MessageType.Normal ? (
          <MessageItem key={message.id} data={message} className="duration-300 animate-in fade-in-0"></MessageItem>
        ) : (
          <PromptItem
            key={message.id}
            data={message}
            className={cn('duration-300 animate-in fade-in-0', {
              'pt-4': index === 0,
              'pb-4': index === messageList.length - 1
            })}
          ></PromptItem>
        )
      )}
    </MessageList>
  )
}

Main.displayName = 'Main'

export default Main
