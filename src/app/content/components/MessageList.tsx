import { FC, useState, type ReactElement } from 'react'

import { type MessageItemProps } from './MessageItem'
import { type PromptItemProps } from './PromptItem'
import { ScrollArea } from '@/components/ui/ScrollArea'
import { Virtuoso } from 'react-virtuoso'

export interface MessageListProps {
  children?: Array<ReactElement<MessageItemProps | PromptItemProps>>
}
const MessageList: FC<MessageListProps> = ({ children }) => {
  const [scrollParentRef, setScrollParentRef] = useState<HTMLDivElement | null>(null)

  return (
    <ScrollArea ref={setScrollParentRef} className="dark:bg-slate-900">
      <Virtuoso
        defaultItemHeight={108}
        followOutput={(isAtBottom: boolean) => (isAtBottom ? 'smooth' : 'auto')}
        initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
        data={children}
        customScrollParent={scrollParentRef!}
        itemContent={(_: any, item: ReactElement<MessageItemProps | PromptItemProps>) => item}
      />
    </ScrollArea>
  )
}

MessageList.displayName = 'MessageList'

export default MessageList
