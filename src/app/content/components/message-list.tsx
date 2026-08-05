import { useState, type FC, type ReactElement } from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Virtuoso } from 'react-virtuoso'

export interface MessageListProps {
  children?: ReactElement[] | null
}

const itemKey = (_: number, item: ReactElement) => {
  if (item.key === null) throw new TypeError('MessageList items require a stable key')
  return item.key
}

const MessageList: FC<MessageListProps> = ({ children }) => {
  const [scrollParentRef, setScrollParentRef] = useState<HTMLDivElement | null>(null)

  return (
    <ScrollArea ref={setScrollParentRef} className="dark:bg-slate-900">
      {children !== null && children !== undefined && scrollParentRef ? (
        <Virtuoso
          defaultItemHeight={108}
          increaseViewportBy={200}
          overscan={200}
          followOutput={(isAtBottom: boolean) => (isAtBottom ? 'smooth' : false)}
          initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
          data={children}
          customScrollParent={scrollParentRef}
          computeItemKey={itemKey}
          skipAnimationFrameInResizeObserver
          itemContent={(_, item) => item}
        />
      ) : null}
    </ScrollArea>
  )
}

MessageList.displayName = 'MessageList'

export default MessageList
