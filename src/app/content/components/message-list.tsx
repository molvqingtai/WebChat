import { useCallback, useLayoutEffect, useMemo, useRef, useState, type FC, type ReactElement } from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { ArrowDownIcon } from 'lucide-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'

export interface MessageListProps {
  children?: ReactElement[] | null
}

const itemKey = (_: number, item: ReactElement) => {
  if (item.key === null) throw new TypeError('MessageList items require a stable key')
  return item.key
}

type ChildUpdate =
  | { kind: 'initial' | 'none' | 'replace' }
  | {
      kind: 'head' | 'tail'
      count: number
    }
  | {
      headCount: number
      kind: 'head-tail'
      tailCount: number
    }

type ScrollCommand =
  | { kind: 'cancel-initial'; top: number }
  | { kind: 'follow-bottom' | 'follow-latest' }
  | { index: number; kind: 'head-rebase'; offset: number }

const hasPrefix = (prefix: readonly string[], values: readonly string[]) =>
  prefix.length <= values.length && prefix.every((value, index) => values[index] === value)

const hasSuffix = (suffix: readonly string[], values: readonly string[]) =>
  suffix.length <= values.length &&
  suffix.every((value, index) => values[values.length - suffix.length + index] === value)

const hasSameItems = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index])

const getVisibleItemLocation = (scrollParent: HTMLElement) => {
  const viewportBounds = scrollParent.getBoundingClientRect()
  const item = Array.from(scrollParent.querySelectorAll<HTMLElement>('[data-index]')).find((item) => {
    const bounds = item.getBoundingClientRect()
    return bounds.top >= viewportBounds.top && bounds.bottom <= viewportBounds.bottom
  })
  const index = Number(item?.dataset.index)
  if (!item || !Number.isInteger(index)) return null

  return { index, offset: viewportBounds.top - item.getBoundingClientRect().top }
}

type HeadAnchor = {
  index: number
  key: string
  offset: number
}

const getHeadAnchor = (scrollParent: HTMLElement, itemKeys: readonly string[]): HeadAnchor | null => {
  const viewportBounds = scrollParent.getBoundingClientRect()
  const item = Array.from(scrollParent.querySelectorAll<HTMLElement>('[data-index]')).find((item) => {
    const bounds = item.getBoundingClientRect()
    return bounds.top < viewportBounds.bottom && bounds.bottom > viewportBounds.top
  })
  const index = Number(item?.dataset.index)
  const key = itemKeys[index]
  if (!item || !Number.isInteger(index) || key === undefined) return null

  return { index, key, offset: viewportBounds.top - item.getBoundingClientRect().top }
}

const isViewportAtBottom = (scrollParent: HTMLElement) =>
  scrollParent.scrollTop + scrollParent.clientHeight >= scrollParent.scrollHeight - 1

const getChildUpdate = (previous: readonly string[] | null, current: readonly string[]): ChildUpdate => {
  if (previous === null) return { kind: 'initial' }
  if (hasSameItems(previous, current)) return { kind: 'none' }
  if (current.length > previous.length && hasPrefix(previous, current)) {
    return { kind: 'tail', count: current.length - previous.length }
  }
  if (current.length > previous.length && hasSuffix(previous, current)) {
    return { kind: 'head', count: current.length - previous.length }
  }
  if (current.length > previous.length) {
    for (let headCount = 1; headCount < current.length - previous.length; headCount += 1) {
      const tailCount = current.length - previous.length - headCount
      if (hasSameItems(previous, current.slice(headCount, headCount + previous.length))) {
        return { kind: 'head-tail', headCount, tailCount }
      }
    }
  }
  return { kind: 'replace' }
}

const INITIAL_FIRST_ITEM_INDEX = 1_000_000
const INITIAL_TOP_MOST_ITEM_INDEX = { index: 'LAST' as const, align: 'end' as const }

const MessageList: FC<MessageListProps> = ({ children }) => {
  const [scrollParentRef, setScrollParentRef] = useState<HTMLDivElement | null>(null)
  const [initialTopMostItemIndex, setInitialTopMostItemIndex] = useState<
    typeof INITIAL_TOP_MOST_ITEM_INDEX | undefined
  >(INITIAL_TOP_MOST_ITEM_INDEX)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const previousItemKeysRef = useRef<readonly string[] | null>(null)
  const firstItemIndexRef = useRef(INITIAL_FIRST_ITEM_INDEX)
  const lastHeadItemKeysRef = useRef<readonly string[] | null>(null)
  const lastTailItemKeysRef = useRef<readonly string[] | null>(null)
  const atBottomRef = useRef(true)
  const manualScrollIntentRef = useRef(false)
  const manualScrollActiveRef = useRef(false)
  const manualScrollPausedRef = useRef(false)
  const initialScrollCancellationEligibleRef = useRef(true)
  const initialScrollCancellationPendingRef = useRef(false)
  const initialScrollCancellationPassedHeadRef = useRef(false)
  const headAnchorRef = useRef<HeadAnchor | null>(null)
  const latestRecoveryRef = useRef(false)
  const newMessageCountRef = useRef(0)
  const hasChildren = children !== null && children !== undefined
  const itemKeys = useMemo(
    () => (hasChildren ? children.map((item, index) => itemKey(index, item)) : []),
    [children, hasChildren]
  )
  const itemKeysRef = useRef<readonly string[]>(itemKeys)
  const childUpdate = useMemo(() => getChildUpdate(previousItemKeysRef.current, itemKeys), [itemKeys])
  const headCount =
    childUpdate.kind === 'head' ? childUpdate.count : childUpdate.kind === 'head-tail' ? childUpdate.headCount : 0
  const tailCount =
    childUpdate.kind === 'tail' ? childUpdate.count : childUpdate.kind === 'head-tail' ? childUpdate.tailCount : 0
  const isHeadPrepend = headCount > 0 && lastHeadItemKeysRef.current !== itemKeys
  const isTailAppend = tailCount > 0
  const isNewTailAppend = isTailAppend && lastTailItemKeysRef.current !== itemKeys
  const firstItemIndex = isHeadPrepend ? firstItemIndexRef.current - headCount : firstItemIndexRef.current

  const clearNewMessageCount = useCallback(() => {
    if (newMessageCountRef.current === 0) return
    newMessageCountRef.current = 0
    setNewMessageCount(0)
  }, [])

  const promoteManualScroll = useCallback(() => {
    if (!manualScrollIntentRef.current) return
    manualScrollIntentRef.current = false
    manualScrollActiveRef.current = true
  }, [])

  const canFollowLatest = useCallback(
    (atBottom: boolean) =>
      atBottom && !latestRecoveryRef.current && !manualScrollActiveRef.current && !manualScrollPausedRef.current,
    []
  )

  const clearInitialScrollCancellation = useCallback(() => {
    initialScrollCancellationPendingRef.current = false
    initialScrollCancellationPassedHeadRef.current = false
  }, [])

  const clearHeadAnchor = useCallback(() => {
    headAnchorRef.current = null
  }, [])

  const cancelLatestRecovery = useCallback(() => {
    latestRecoveryRef.current = false
  }, [])

  const runScrollCommand = useCallback((command: ScrollCommand) => {
    const handle = virtuosoRef.current
    if (!handle) return

    switch (command.kind) {
      case 'cancel-initial':
        handle.scrollTo({ top: command.top })
        return
      case 'follow-bottom':
        handle.autoscrollToBottom()
        return
      case 'follow-latest':
        handle.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' })
        return
      case 'head-rebase':
        handle.scrollToIndex({ index: command.index, align: 'start', offset: command.offset, behavior: 'auto' })
    }
  }, [])

  const captureInitialScrollCancellation = useCallback(() => {
    if (!scrollParentRef || !initialScrollCancellationPendingRef.current) return

    if (initialScrollCancellationPassedHeadRef.current) return

    if (isViewportAtBottom(scrollParentRef)) return

    if (!getVisibleItemLocation(scrollParentRef)) return

    initialScrollCancellationPendingRef.current = false
    runScrollCommand({ kind: 'cancel-initial', top: scrollParentRef.scrollTop })
    clearInitialScrollCancellation()
  }, [clearInitialScrollCancellation, runScrollCommand, scrollParentRef])

  const captureHeadAnchor = useCallback(() => {
    if (!scrollParentRef || !manualScrollPausedRef.current || isViewportAtBottom(scrollParentRef)) return

    headAnchorRef.current = getHeadAnchor(scrollParentRef, itemKeysRef.current)
  }, [scrollParentRef])

  const acknowledgeManualDeparture = useCallback(() => {
    if (!scrollParentRef || isViewportAtBottom(scrollParentRef)) return

    promoteManualScroll()
    if (!manualScrollActiveRef.current) return

    cancelLatestRecovery()
    atBottomRef.current = false
    manualScrollPausedRef.current = true
    setIsAtBottom(false)
    captureHeadAnchor()
    captureInitialScrollCancellation()
  }, [cancelLatestRecovery, captureHeadAnchor, captureInitialScrollCancellation, promoteManualScroll, scrollParentRef])

  useLayoutEffect(() => {
    itemKeysRef.current = itemKeys
  }, [itemKeys])

  useLayoutEffect(() => {
    if (isNewTailAppend) {
      lastTailItemKeysRef.current = itemKeys
      if (latestRecoveryRef.current) {
        clearNewMessageCount()
      } else if (!canFollowLatest(atBottomRef.current)) {
        newMessageCountRef.current += tailCount
        setNewMessageCount(newMessageCountRef.current)
      }
    }
    if (isHeadPrepend) {
      firstItemIndexRef.current = firstItemIndex
      lastHeadItemKeysRef.current = itemKeys
      if (initialScrollCancellationPendingRef.current) {
        if (initialScrollCancellationPassedHeadRef.current) {
          clearInitialScrollCancellation()
        } else {
          initialScrollCancellationPassedHeadRef.current = true
        }
      }
      const headAnchor = headAnchorRef.current
      clearHeadAnchor()
      if (headAnchor) {
        const index = headAnchor.index + headCount
        if (itemKeys[index] === headAnchor.key) {
          runScrollCommand({ kind: 'head-rebase', index, offset: headAnchor.offset })
        }
      }
    }
    if (childUpdate.kind === 'tail' || childUpdate.kind === 'replace') {
      clearInitialScrollCancellation()
    }
    if (childUpdate.kind === 'replace') {
      clearHeadAnchor()
      cancelLatestRecovery()
    }
    previousItemKeysRef.current = hasChildren ? itemKeys : null
  }, [
    canFollowLatest,
    cancelLatestRecovery,
    childUpdate,
    clearHeadAnchor,
    clearInitialScrollCancellation,
    clearNewMessageCount,
    firstItemIndex,
    headCount,
    hasChildren,
    isHeadPrepend,
    isNewTailAppend,
    isTailAppend,
    itemKeys,
    runScrollCommand,
    tailCount
  ])

  useLayoutEffect(() => {
    if (!scrollParentRef) return

    const scrollArea = scrollParentRef.closest<HTMLElement>('[data-slot="scroll-area"]') ?? scrollParentRef
    const markManualScrollIntent = () => {
      cancelLatestRecovery()
      if (initialScrollCancellationEligibleRef.current) {
        initialScrollCancellationEligibleRef.current = false
        initialScrollCancellationPendingRef.current = true
        setInitialTopMostItemIndex(undefined)
      }
      manualScrollIntentRef.current = true
    }
    const markScrollbarScrollIntent = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-slot="scroll-area-scrollbar"]')) {
        markManualScrollIntent()
      }
    }

    scrollArea.addEventListener('wheel', markManualScrollIntent, { passive: true })
    scrollArea.addEventListener('touchmove', markManualScrollIntent, { passive: true })
    scrollArea.addEventListener('pointerdown', markScrollbarScrollIntent)
    const handleScroll = () => {
      promoteManualScroll()
      acknowledgeManualDeparture()
    }

    scrollParentRef.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      scrollArea.removeEventListener('wheel', markManualScrollIntent)
      scrollArea.removeEventListener('touchmove', markManualScrollIntent)
      scrollArea.removeEventListener('pointerdown', markScrollbarScrollIntent)
      scrollParentRef.removeEventListener('scroll', handleScroll)
      clearInitialScrollCancellation()
      clearHeadAnchor()
      cancelLatestRecovery()
    }
  }, [
    acknowledgeManualDeparture,
    cancelLatestRecovery,
    clearHeadAnchor,
    clearInitialScrollCancellation,
    promoteManualScroll,
    scrollParentRef
  ])

  const handleAtBottomStateChange = useCallback(
    (atBottom: boolean) => {
      atBottomRef.current = atBottom
      setIsAtBottom(atBottom)
      if (!atBottom) {
        acknowledgeManualDeparture()
        return
      }
      clearInitialScrollCancellation()
      clearHeadAnchor()
      if (manualScrollActiveRef.current) return

      cancelLatestRecovery()
      manualScrollPausedRef.current = false
      clearNewMessageCount()
    },
    [
      acknowledgeManualDeparture,
      cancelLatestRecovery,
      clearHeadAnchor,
      clearInitialScrollCancellation,
      clearNewMessageCount
    ]
  )

  const handleIsScrolling = useCallback(
    (isScrolling: boolean) => {
      if (isScrolling) {
        promoteManualScroll()
        acknowledgeManualDeparture()
        return
      }
      manualScrollIntentRef.current = false
      if (!manualScrollActiveRef.current) return

      manualScrollActiveRef.current = false
      const atBottom = scrollParentRef ? isViewportAtBottom(scrollParentRef) : atBottomRef.current
      if (!atBottom) return

      cancelLatestRecovery()
      atBottomRef.current = true
      setIsAtBottom(true)
      manualScrollPausedRef.current = false
      clearHeadAnchor()
      clearNewMessageCount()
      runScrollCommand({ kind: 'follow-bottom' })
    },
    [
      acknowledgeManualDeparture,
      cancelLatestRecovery,
      clearHeadAnchor,
      clearNewMessageCount,
      promoteManualScroll,
      runScrollCommand,
      scrollParentRef
    ]
  )

  const handleFollowOutput = useCallback(
    (atBottom: boolean) =>
      isTailAppend && ((isNewTailAppend && latestRecoveryRef.current) || canFollowLatest(atBottom)) ? 'smooth' : false,
    [canFollowLatest, isNewTailAppend, isTailAppend]
  )

  const handleFollowLatest = useCallback(() => {
    manualScrollIntentRef.current = false
    manualScrollActiveRef.current = false
    manualScrollPausedRef.current = false
    latestRecoveryRef.current = true
    clearInitialScrollCancellation()
    clearHeadAnchor()
    clearNewMessageCount()
    runScrollCommand({ kind: 'follow-latest' })
  }, [clearHeadAnchor, clearInitialScrollCancellation, clearNewMessageCount, runScrollCommand])

  const followActionLabel =
    newMessageCount === 0 ? '回到底部' : `${newMessageCount > 99 ? '99+' : newMessageCount} 条新消息`

  return (
    <div className="relative min-h-0">
      <ScrollArea ref={setScrollParentRef} className="size-full dark:bg-slate-900">
        {hasChildren && scrollParentRef ? (
          <Virtuoso
            ref={virtuosoRef}
            defaultItemHeight={108}
            increaseViewportBy={200}
            overscan={200}
            atBottomStateChange={handleAtBottomStateChange}
            isScrolling={handleIsScrolling}
            followOutput={isTailAppend ? handleFollowOutput : false}
            firstItemIndex={firstItemIndex}
            initialTopMostItemIndex={initialTopMostItemIndex}
            data={children}
            customScrollParent={scrollParentRef}
            computeItemKey={itemKey}
            skipAnimationFrameInResizeObserver
            itemContent={(_, item) => item}
          />
        ) : null}
      </ScrollArea>
      {hasChildren && scrollParentRef && !isAtBottom ? (
        <button
          type="button"
          aria-label={followActionLabel}
          title={followActionLabel}
          className="bg-secondary absolute right-3 bottom-3 z-10 inline-flex h-7 items-center gap-x-1.5 rounded-full px-2 text-xs font-medium text-slate-500 shadow-sm hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          onClick={handleFollowLatest}
        >
          <ArrowDownIcon size={14} aria-hidden="true" />
          <span>{followActionLabel}</span>
        </button>
      ) : null}
    </div>
  )
}

MessageList.displayName = 'MessageList'

export default MessageList
