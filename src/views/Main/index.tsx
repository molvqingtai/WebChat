import { type FC } from 'react'
import { useRemeshDomain, useRemeshQuery } from 'remesh-react'
import MessageList from '@/components/MessageList'
import MessageItem from '@/components/MessageItem'
import MessageListDomain from '@/domain/MessageList'

const Main: FC = () => {
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const messageList = useRemeshQuery(messageListDomain.query.ListQuery())

  return (
    <MessageList>
      {messageList.map((message) => (
        <MessageItem key={message.id} data={message}></MessageItem>
      ))}
    </MessageList>
  )
}

Main.displayName = 'Main'

export default Main
