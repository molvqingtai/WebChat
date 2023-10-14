import { type ReactElement, type FC } from 'react'

import { type MessageItemProps } from './MessageItem'
import { ScrollArea } from '@/components/ui/ScrollArea'

export interface MessageListProps {
  children?: Array<ReactElement<MessageItemProps>>
}
// [&>div>div]:!block fix word-break: break-word;
const MessageList: FC<MessageListProps> = ({ children }) => {
  return <ScrollArea className="[&>div>div]:!block">{children}</ScrollArea>
}

MessageList.displayName = 'MessageList'

export default MessageList
