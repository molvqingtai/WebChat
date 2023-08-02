import { type ReactElement, type FC } from 'react'

import { type MessageItemProps } from './MessageItem'

export interface MessageListProps {
  children?: Array<ReactElement<MessageItemProps>>
}
const MessageList: FC<MessageListProps> = ({ children }) => {
  return <div className="grid content-start overflow-y-auto p-4">{children}</div>
}

export default MessageList
