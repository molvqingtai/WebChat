import { useEffect, type FC, useRef } from 'react'
import { useRemeshDomain, useRemeshQuery } from 'remesh-react'

import MessageList from '@/components/MessageList'
import MessageItem from '@/components/MessageItem'
import MessageListDomain from '@/domain/MessageList'

const Main: FC = () => {
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const messageList = useRemeshQuery(messageListDomain.query.ListQuery())
  const messageListRef = useRef<HTMLDivElement>(null)

  const isUpdate = useRef(false)

  useEffect(() => {
    const lastMessageRef = messageListRef.current?.querySelector('[data-index]:last-child')
    const timerId = setTimeout(() => {
      requestAnimationFrame(() => {
        console.log(isUpdate.current)
        lastMessageRef?.scrollIntoView({ behavior: isUpdate.current ? 'smooth' : 'instant', block: 'end' })
        isUpdate.current = true
      })
    }, 0)

    return () => clearTimeout(timerId)
  }, [messageList.length])

  return (
    <MessageList ref={messageListRef}>
      {messageList.map((message, index) => (
        <MessageItem key={message.id} data={message} index={index}></MessageItem>
      ))}
    </MessageList>
  )
}

Main.displayName = 'Main'

export default Main
