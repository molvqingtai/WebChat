import { type ReactElement, type FC } from 'react'

import { type MessageItemProps } from './MessageItem'
import { ScrollArea } from '@/components/ui/ScrollArea'

export interface MessageListProps {
  children?: Array<ReactElement<MessageItemProps>>
}
const MessageList: FC<MessageListProps> = ({ children }) => {
  return <ScrollArea>{children}</ScrollArea>
}

MessageList.displayName = 'MessageList'

export default MessageList
