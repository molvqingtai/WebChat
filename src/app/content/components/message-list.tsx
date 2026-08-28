import { useEffect, useRef, useState, type FC, type ReactElement } from 'react'
import { ArrowDownIcon } from 'lucide-react'
import NumberFlow from '@number-flow/react'

import { cn } from '@/utils'
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable
} from '@/components/ui/message-scroller'

export interface MessageListProps {
  children?: ReactElement[] | null
}

const itemKey = (_: number, item: ReactElement) => {
  if (item.key === null) throw new TypeError('MessageList items require a stable key')
  return item.key
}

// Follow layer: initial bottom comes from the provider's defaultScrollPosition="end"; manual
// wheel/touch/keyboard intent and prepend anchoring are owned by the primitive. This layer only
// adds the chat semantics the primitive does not carry: smooth-follow a new tail while settled at
// the bottom, and count off-bottom arrivals behind one recovery action.
const MessageListFollow: FC<{ itemKeys: readonly string[] }> = ({ itemKeys }) => {
  const { scrollToEnd } = useMessageScroller()
  const scrollable = useMessageScrollerScrollable()
  const atEnd = !scrollable.end
  const atEndRef = useRef(atEnd)
  const previousTailKeyRef = useRef<string | null>(itemKeys.at(-1) ?? null)
  const previousCountRef = useRef(itemKeys.length)
  const [newMessageCount, setNewMessageCount] = useState(0)

  useEffect(() => {
    atEndRef.current = atEnd
    if (atEnd) setNewMessageCount(0)
  }, [atEnd])

  useEffect(() => {
    const previousTailKey = previousTailKeyRef.current
    const previousCount = previousCountRef.current
    previousTailKeyRef.current = itemKeys.at(-1) ?? null
    previousCountRef.current = itemKeys.length
    const tailKey = previousTailKeyRef.current
    if (tailKey === null || tailKey === previousTailKey) return
    if (previousTailKey === null || !itemKeys.includes(previousTailKey)) {
      // The list was replaced; there is no meaningful unread delta.
      setNewMessageCount(0)
      if (atEndRef.current) scrollToEnd({ behavior: 'auto' })
      return
    }
    // Tail append of one or more rows.
    const added = Math.max(1, itemKeys.length - previousCount)
    if (atEndRef.current) {
      setNewMessageCount(0)
      scrollToEnd({ behavior: 'smooth' })
    } else {
      setNewMessageCount((count) => count + added)
    }
  }, [itemKeys, scrollToEnd])

  const actionVisible = newMessageCount > 0 || !atEnd
  const label =
    newMessageCount > 0
      ? `${newMessageCount > 99 ? '99+' : newMessageCount} new message${newMessageCount === 1 ? '' : 's'}`
      : 'Scroll to latest messages'

  return (
    <button
      type="button"
      data-testid="follow-latest-action"
      data-state={actionVisible ? 'open' : 'closed'}
      aria-label={label}
      className={cn(
        'bg-secondary absolute bottom-3 left-1/2 z-10 grid h-7 -translate-x-1/2 items-center overflow-hidden rounded-full text-xs font-medium text-slate-500 shadow-sm transition-[opacity,grid-template-columns,gap,padding] duration-200 ease-out hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none disabled:cursor-default dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
        newMessageCount > 0 ? 'grid-cols-[auto_1fr] gap-x-1.5 px-2' : 'grid-cols-[auto_0fr] gap-x-0 px-1.5',
        actionVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
      )}
      onClick={() => {
        setNewMessageCount(0)
        scrollToEnd({ behavior: 'smooth' })
      }}
    >
      <ArrowDownIcon size={14} aria-hidden="true" />
      {newMessageCount > 0 ? (
        <span className="min-w-0 overflow-hidden text-xs whitespace-nowrap">
          {import.meta.env.FIREFOX ? (
            <span className="tabular-nums">
              {Math.min(newMessageCount, 99)}
              {newMessageCount > 99 ? '+' : ''}
            </span>
          ) : (
            <span className="inline-flex tabular-nums">
              <NumberFlow value={Math.min(newMessageCount, 99)} />
              {newMessageCount > 99 ? '+' : null}
            </span>
          )}{' '}
          {newMessageCount === 1 ? 'new message' : 'new messages'}
        </span>
      ) : null}
    </button>
  )
}

const MessageList: FC<MessageListProps> = ({ children }) => {
  const items = children ?? null
  const itemKeys = items ? items.map((item, index) => String(itemKey(index, item))) : null

  return (
    <MessageScrollerProvider autoScroll={false} defaultScrollPosition="end">
      <MessageScroller className="dark:bg-slate-900">
        {/* The provider/viewport/content shell stays mounted across the loading (`null`),
            empty (`[]`), and loaded phases; only rows gate on content. The primitive's initial
            end positioning is driven by its itemCount 0→N transition, which must run in a commit
            after the shell's refs have attached — mounting the shell conditionally with the
            first rows would make that transition see a null viewport and silently skip it. */}
        <MessageScrollerViewport className="dark:bg-slate-900">
          <MessageScrollerContent className="gap-0">
            {items && itemKeys
              ? items.map((item, index) => (
                  <MessageScrollerItem key={itemKeys[index]} messageId={itemKeys[index]}>
                    {item}
                  </MessageScrollerItem>
                ))
              : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {itemKeys ? <MessageListFollow itemKeys={itemKeys} /> : null}
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

MessageList.displayName = 'MessageList'

export default MessageList
