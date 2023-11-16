import { type ReactElement } from 'react'

import React from 'react'
import { type MessageItemProps } from './MessageItem'
import { ScrollArea } from '@/components/ui/ScrollArea'

export interface MessageListProps {
  children?: Array<ReactElement<MessageItemProps>>
}
// [&>div>div]:!block fix word-break: break-word;
const MessageList = React.forwardRef<HTMLDivElement, MessageListProps>(({ children }, ref) => {
  return (
    <ScrollArea ref={ref} className="[&>div>div]:!block">
      {children}
    </ScrollArea>
  )
})

MessageList.displayName = 'MessageList'

export default MessageList
