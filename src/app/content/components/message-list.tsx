import {
  useCallback,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type ReactElement
} from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'
import NumberFlow from '@number-flow/react'
import { ArrowDownIcon } from 'lucide-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { cn } from '@/utils'

export interface MessageListProps {
  children?: ReactElement[] | null
  localSendToken?: number
}

const itemKey = (_: number, item: ReactElement) => {
  if (item.key === null) throw new TypeError('MessageList items require a stable key')
  return item.key
}

type ChildUpdate =
  | { update: 'initial' | 'none' | 'replace' }
  | {
      update: 'head' | 'tail'
      count: number
    }
  | {
      headCount: number
      update: 'head-tail'
      tailCount: number
    }

type ScrollCommand =
  | { command: 'cancel-initial'; top: number }
  | { command: 'follow-bottom' | 'follow-latest' }
  | { command: 'head-rebase'; index: number; offset: number }

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

type ViewportActionState = {
  isAtBottom: boolean
  isBeyondHalfScreen: boolean
  isManualScrollDown: boolean
}

type TailBottomSnapshot = {
  atBottom: boolean
  callbackPending: boolean
}

type HeadRebaseTransaction = {
  index: number
  itemKeys: readonly string[]
  key: string
  offset: number
  phase: 'registered' | 'pending'
  viewport: HTMLElement
}

type PendingProgrammaticScroll = {
  owner: HeadRebaseTransaction
  viewport: HTMLElement
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

const hasHeadRebaseTarget = (transaction: HeadRebaseTransaction) => {
  if (transaction.itemKeys[transaction.index] !== transaction.key) return false

  const item = transaction.viewport.querySelector<HTMLElement>(`[data-index="${transaction.index}"]`)
  if (!item) return false

  return (
    Math.abs(transaction.viewport.getBoundingClientRect().top - item.getBoundingClientRect().top - transaction.offset) <
    2
  )
}

const isViewportAtBottom = (scrollParent: HTMLElement) =>
  scrollParent.scrollTop + scrollParent.clientHeight >= scrollParent.scrollHeight - 1

const getViewportActionState = (
  scrollParent: HTMLElement,
  isAtBottom: boolean,
  isManualScrollDown: boolean
): ViewportActionState => {
  const distanceFromBottom = Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight - scrollParent.scrollTop)
  return {
    isAtBottom,
    isBeyondHalfScreen: scrollParent.clientHeight > 0 && distanceFromBottom > scrollParent.clientHeight * 0.5,
    isManualScrollDown
  }
}

const getPhysicalViewportActionState = (
  scrollParent: HTMLElement,
  isManualScrollDown: boolean
): ViewportActionState => {
  const { clientHeight, scrollHeight, scrollTop } = scrollParent
  const distanceFromBottom = Math.max(0, scrollHeight - clientHeight - scrollTop)
  return {
    isAtBottom: scrollTop + clientHeight >= scrollHeight - 1,
    isBeyondHalfScreen: clientHeight > 0 && distanceFromBottom > clientHeight * 0.5,
    isManualScrollDown
  }
}

const getChildUpdate = (previous: readonly string[] | null, current: readonly string[]): ChildUpdate => {
  if (previous === null) return { update: 'initial' }
  if (hasSameItems(previous, current)) return { update: 'none' }
  if (current.length > previous.length && hasPrefix(previous, current)) {
    return { update: 'tail', count: current.length - previous.length }
  }
  if (current.length > previous.length && hasSuffix(previous, current)) {
    return { update: 'head', count: current.length - previous.length }
  }
  if (current.length > previous.length) {
    for (let headCount = 1; headCount < current.length - previous.length; headCount += 1) {
      const tailCount = current.length - previous.length - headCount
      if (hasSameItems(previous, current.slice(headCount, headCount + previous.length))) {
        return { update: 'head-tail', headCount, tailCount }
      }
    }
  }
  return { update: 'replace' }
}

const INITIAL_FIRST_ITEM_INDEX = 1_000_000
const INITIAL_TOP_MOST_ITEM_INDEX = { index: 'LAST' as const, align: 'end' as const }

const MessageList: FC<MessageListProps> = ({ children, localSendToken = 0 }) => {
  const [scrollParentRef, setScrollParentRef] = useState<HTMLDivElement | null>(null)
  const [initialTopMostItemIndex, setInitialTopMostItemIndex] = useState<
    typeof INITIAL_TOP_MOST_ITEM_INDEX | undefined
  >(INITIAL_TOP_MOST_ITEM_INDEX)
  const [viewportActionState, setViewportActionState] = useState<ViewportActionState>({
    isAtBottom: true,
    isBeyondHalfScreen: false,
    isManualScrollDown: false
  })
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
  const manualScrollDownRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const pendingProgrammaticScrollRef = useRef<PendingProgrammaticScroll | null>(null)
  const currentItemKeysRef = useRef<readonly string[]>([])
  const activeViewportRef = useRef<HTMLElement | null>(null)
  const initialScrollCancellationEligibleRef = useRef(true)
  const initialScrollCancellationPendingRef = useRef(false)
  const initialScrollCancellationPassedHeadRef = useRef(false)
  const headAnchorRef = useRef<HeadAnchor | null>(null)
  const headRebaseTransactionRef = useRef<HeadRebaseTransaction | null>(null)
  const latestRecoveryRef = useRef(false)
  const newMessageCountRef = useRef(0)
  const lastLocalSendTokenRef = useRef(localSendToken)
  const hasChildren = children !== null && children !== undefined
  const itemKeys = useMemo(
    () => (hasChildren ? children.map((item, index) => itemKey(index, item)) : []),
    [children, hasChildren]
  )
  const itemKeysRef = useRef<readonly string[]>(itemKeys)
  const childUpdate = useMemo(() => getChildUpdate(previousItemKeysRef.current, itemKeys), [itemKeys])
  const headCount =
    childUpdate.update === 'head' ? childUpdate.count : childUpdate.update === 'head-tail' ? childUpdate.headCount : 0
  const tailCount =
    childUpdate.update === 'tail' ? childUpdate.count : childUpdate.update === 'head-tail' ? childUpdate.tailCount : 0
  const isHeadPrepend = headCount > 0 && lastHeadItemKeysRef.current !== itemKeys
  const isTailAppend = tailCount > 0
  const isNewTailAppend = isTailAppend && lastTailItemKeysRef.current !== itemKeys
  const tailBottomSnapshot = useMemo<TailBottomSnapshot | null>(
    () =>
      isTailAppend && scrollParentRef ? { atBottom: isViewportAtBottom(scrollParentRef), callbackPending: true } : null,
    [isTailAppend, itemKeys, scrollParentRef]
  )
  const headRebaseTarget = useMemo<HeadAnchor | null>(() => {
    const headAnchor = headAnchorRef.current
    if (
      !isHeadPrepend ||
      !scrollParentRef ||
      !headAnchor ||
      itemKeys[headAnchor.index + headCount] !== headAnchor.key
    ) {
      return null
    }

    return { index: headAnchor.index + headCount, key: headAnchor.key, offset: headAnchor.offset }
  }, [headCount, isHeadPrepend, itemKeys, scrollParentRef])
  const firstItemIndex = isHeadPrepend ? firstItemIndexRef.current - headCount : firstItemIndexRef.current

  const cancelHeadRebaseTransaction = useCallback((transaction?: HeadRebaseTransaction | null) => {
    if (transaction !== undefined && headRebaseTransactionRef.current !== transaction) return

    const currentTransaction = headRebaseTransactionRef.current
    if (currentTransaction && pendingProgrammaticScrollRef.current?.owner === currentTransaction) {
      pendingProgrammaticScrollRef.current = null
    }
    headRebaseTransactionRef.current = null
  }, [])

  useInsertionEffect(() => {
    const transaction = headRebaseTransactionRef.current
    if (!hasChildren || !scrollParentRef || (transaction !== null && transaction.viewport !== scrollParentRef)) {
      cancelHeadRebaseTransaction()
    } else if (transaction) {
      const ownerUpdate = getChildUpdate(transaction.itemKeys, itemKeys)
      if (ownerUpdate.update === 'tail') {
        transaction.itemKeys = itemKeys
      } else if (ownerUpdate.update === 'head') {
        const headCount = ownerUpdate.count
        const nextIndex = transaction.index + headCount
        if (itemKeys[nextIndex] === transaction.key) {
          cancelHeadRebaseTransaction(transaction)
          headRebaseTransactionRef.current = {
            ...transaction,
            index: nextIndex,
            itemKeys,
            phase: 'registered'
          }
        } else {
          cancelHeadRebaseTransaction(transaction)
        }
      } else if (ownerUpdate.update === 'head-tail') {
        const headCount = ownerUpdate.headCount
        const nextIndex = transaction.index + headCount
        if (itemKeys[nextIndex] === transaction.key) {
          cancelHeadRebaseTransaction(transaction)
          headRebaseTransactionRef.current = {
            ...transaction,
            index: nextIndex,
            itemKeys,
            phase: 'registered'
          }
        } else {
          cancelHeadRebaseTransaction(transaction)
        }
      } else if (ownerUpdate.update === 'replace') {
        cancelHeadRebaseTransaction(transaction)
      }
    }

    currentItemKeysRef.current = itemKeys
    activeViewportRef.current = scrollParentRef

    if (headRebaseTarget && scrollParentRef) {
      const nextTransaction: HeadRebaseTransaction = {
        ...headRebaseTarget,
        itemKeys,
        phase: 'registered',
        viewport: scrollParentRef
      }
      cancelHeadRebaseTransaction()
      headRebaseTransactionRef.current = nextTransaction
    }
  }, [cancelHeadRebaseTransaction, childUpdate.update, hasChildren, headRebaseTarget, itemKeys, scrollParentRef])

  useLayoutEffect(() => () => cancelHeadRebaseTransaction(), [cancelHeadRebaseTransaction])

  const clearNewMessageCount = useCallback(() => {
    if (newMessageCountRef.current === 0) return
    newMessageCountRef.current = 0
    setNewMessageCount(0)
  }, [])

  const updateViewportActionState = useCallback(
    (
      actionStateOrAtBottom: ViewportActionState | boolean = scrollParentRef
        ? isViewportAtBottom(scrollParentRef)
        : atBottomRef.current
    ) => {
      if (!scrollParentRef) return

      const nextState =
        typeof actionStateOrAtBottom === 'boolean'
          ? getViewportActionState(scrollParentRef, actionStateOrAtBottom, manualScrollDownRef.current)
          : actionStateOrAtBottom
      setViewportActionState((currentState) =>
        currentState.isAtBottom === nextState.isAtBottom &&
        currentState.isBeyondHalfScreen === nextState.isBeyondHalfScreen &&
        currentState.isManualScrollDown === nextState.isManualScrollDown
          ? currentState
          : nextState
      )
    },
    [scrollParentRef]
  )

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

  const isCurrentListCallback = useCallback(
    () => activeViewportRef.current === scrollParentRef && hasSameItems(currentItemKeysRef.current, itemKeys),
    [itemKeys, scrollParentRef]
  )

  const isCurrentHeadRebaseTransaction = useCallback(
    (transaction: HeadRebaseTransaction) =>
      headRebaseTransactionRef.current === transaction &&
      transaction.viewport === scrollParentRef &&
      hasSameItems(currentItemKeysRef.current, transaction.itemKeys),
    [scrollParentRef]
  )

  const runScrollCommand = useCallback(
    (command: ScrollCommand, headRebaseTransaction: HeadRebaseTransaction | null = null) => {
      const handle = virtuosoRef.current
      if (!handle) return

      switch (command.command) {
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
          if (
            !headRebaseTransaction ||
            !scrollParentRef ||
            !isCurrentHeadRebaseTransaction(headRebaseTransaction) ||
            headRebaseTransaction.phase !== 'registered'
          ) {
            return
          }
          headRebaseTransaction.phase = 'pending'
          pendingProgrammaticScrollRef.current = {
            owner: headRebaseTransaction,
            viewport: headRebaseTransaction.viewport
          }
          handle.scrollToIndex({ index: command.index, align: 'start', offset: command.offset, behavior: 'auto' })
      }
    },
    [isCurrentHeadRebaseTransaction, scrollParentRef]
  )

  const captureInitialScrollCancellation = useCallback(() => {
    if (!scrollParentRef || !initialScrollCancellationPendingRef.current) return

    if (initialScrollCancellationPassedHeadRef.current) return

    if (isViewportAtBottom(scrollParentRef)) return

    if (!getVisibleItemLocation(scrollParentRef)) return

    initialScrollCancellationPendingRef.current = false
    runScrollCommand({ command: 'cancel-initial', top: scrollParentRef.scrollTop })
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
    captureHeadAnchor()
    captureInitialScrollCancellation()
  }, [cancelLatestRecovery, captureHeadAnchor, captureInitialScrollCancellation, promoteManualScroll, scrollParentRef])

  useLayoutEffect(() => {
    itemKeysRef.current = itemKeys
  }, [itemKeys])

  useLayoutEffect(() => {
    if (!scrollParentRef) return

    lastScrollTopRef.current = scrollParentRef.scrollTop
    updateViewportActionState(atBottomRef.current)
  }, [scrollParentRef, updateViewportActionState])

  useLayoutEffect(() => {
    if (isNewTailAppend) {
      lastTailItemKeysRef.current = itemKeys
      const atBottom = tailBottomSnapshot?.atBottom ?? atBottomRef.current
      atBottomRef.current = atBottom
      if (latestRecoveryRef.current) {
        clearNewMessageCount()
      } else if (!canFollowLatest(atBottom)) {
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
      clearHeadAnchor()
    }
    if (childUpdate.update === 'tail' || childUpdate.update === 'replace') {
      clearInitialScrollCancellation()
    }
    if (childUpdate.update === 'replace') {
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
    itemKeys,
    tailBottomSnapshot,
    tailCount,
    updateViewportActionState
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
      lastScrollTopRef.current = scrollParentRef.scrollTop
      manualScrollDownRef.current = false
      cancelHeadRebaseTransaction()
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
      if (!isCurrentListCallback()) return

      const nextScrollTop = scrollParentRef.scrollTop
      const pendingProgrammaticScroll = pendingProgrammaticScrollRef.current
      if (pendingProgrammaticScroll?.viewport === scrollParentRef) {
        const transaction = pendingProgrammaticScroll.owner

        if (
          !isCurrentHeadRebaseTransaction(transaction) ||
          transaction.phase !== 'pending' ||
          !hasHeadRebaseTarget(transaction)
        ) {
          return
        }
        pendingProgrammaticScrollRef.current = null
        manualScrollDownRef.current = false
        lastScrollTopRef.current = nextScrollTop
        const finalActionState = getPhysicalViewportActionState(scrollParentRef, manualScrollDownRef.current)
        atBottomRef.current = finalActionState.isAtBottom
        cancelHeadRebaseTransaction(transaction)
        updateViewportActionState(finalActionState)
        return
      }

      if (headRebaseTransactionRef.current) return

      promoteManualScroll()
      manualScrollDownRef.current = manualScrollActiveRef.current && nextScrollTop > lastScrollTopRef.current
      lastScrollTopRef.current = nextScrollTop
      acknowledgeManualDeparture()
      updateViewportActionState(isViewportAtBottom(scrollParentRef))
    }

    scrollParentRef.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      scrollArea.removeEventListener('wheel', markManualScrollIntent)
      scrollArea.removeEventListener('touchmove', markManualScrollIntent)
      scrollArea.removeEventListener('pointerdown', markScrollbarScrollIntent)
      scrollParentRef.removeEventListener('scroll', handleScroll)
    }
  }, [
    acknowledgeManualDeparture,
    cancelHeadRebaseTransaction,
    cancelLatestRecovery,
    clearHeadAnchor,
    clearInitialScrollCancellation,
    promoteManualScroll,
    isCurrentHeadRebaseTransaction,
    isCurrentListCallback,
    scrollParentRef,
    updateViewportActionState
  ])

  const handleAtBottomStateChange = useCallback(
    (reportedAtBottom: boolean) => {
      if (!isCurrentListCallback()) return
      if (headRebaseTransactionRef.current) return
      if (tailBottomSnapshot?.callbackPending && !tailBottomSnapshot.atBottom) {
        tailBottomSnapshot.callbackPending = false
        return
      }
      const atBottom = scrollParentRef ? isViewportAtBottom(scrollParentRef) : reportedAtBottom
      atBottomRef.current = atBottom
      if (!atBottom) {
        acknowledgeManualDeparture()
        updateViewportActionState(false)
        return
      }
      clearInitialScrollCancellation()
      clearHeadAnchor()
      cancelLatestRecovery()
      manualScrollPausedRef.current = false
      clearNewMessageCount()
      manualScrollDownRef.current = false
      updateViewportActionState(true)
      if (manualScrollActiveRef.current) return
    },
    [
      acknowledgeManualDeparture,
      cancelLatestRecovery,
      clearHeadAnchor,
      clearInitialScrollCancellation,
      clearNewMessageCount,
      isCurrentListCallback,
      scrollParentRef,
      tailBottomSnapshot,
      updateViewportActionState
    ]
  )

  const handleIsScrolling = useCallback(
    (isScrolling: boolean) => {
      if (!isCurrentListCallback()) return
      if (headRebaseTransactionRef.current) return
      if (isScrolling) {
        promoteManualScroll()
        acknowledgeManualDeparture()
        return
      }
      manualScrollIntentRef.current = false
      if (!manualScrollActiveRef.current) {
        manualScrollDownRef.current = false
        updateViewportActionState()
        return
      }

      manualScrollActiveRef.current = false
      manualScrollDownRef.current = false
      const atBottom = scrollParentRef ? isViewportAtBottom(scrollParentRef) : atBottomRef.current
      if (!atBottom) {
        updateViewportActionState(false)
        return
      }

      cancelLatestRecovery()
      atBottomRef.current = true
      manualScrollPausedRef.current = false
      clearHeadAnchor()
      clearNewMessageCount()
      updateViewportActionState(true)
      runScrollCommand({ command: 'follow-bottom' })
    },
    [
      acknowledgeManualDeparture,
      cancelLatestRecovery,
      clearHeadAnchor,
      clearNewMessageCount,
      promoteManualScroll,
      runScrollCommand,
      isCurrentListCallback,
      scrollParentRef,
      updateViewportActionState
    ]
  )

  const handleTotalListHeightChanged = useCallback(() => {
    if (!scrollParentRef || !isCurrentListCallback()) return
    const headRebaseTransaction = headRebaseTransactionRef.current
    if (headRebaseTransaction) {
      if (!isCurrentHeadRebaseTransaction(headRebaseTransaction)) return
      if (headRebaseTransaction.phase === 'registered') {
        if (hasHeadRebaseTarget(headRebaseTransaction)) {
          const finalActionState = getPhysicalViewportActionState(scrollParentRef, manualScrollDownRef.current)
          atBottomRef.current = finalActionState.isAtBottom
          cancelHeadRebaseTransaction(headRebaseTransaction)
          updateViewportActionState(finalActionState)
          return
        }
        runScrollCommand(
          { command: 'head-rebase', index: headRebaseTransaction.index, offset: headRebaseTransaction.offset },
          headRebaseTransaction
        )
      }
      return
    }

    const atBottom = isViewportAtBottom(scrollParentRef)
    if (atBottom !== atBottomRef.current) {
      handleAtBottomStateChange(atBottom)
      return
    }
    updateViewportActionState(atBottom)
  }, [
    cancelHeadRebaseTransaction,
    handleAtBottomStateChange,
    isCurrentHeadRebaseTransaction,
    isCurrentListCallback,
    runScrollCommand,
    scrollParentRef,
    updateViewportActionState
  ])

  const handleFollowOutput = useCallback(
    (reportedAtBottom: boolean) => {
      const atBottom = tailBottomSnapshot?.atBottom ?? reportedAtBottom
      if (tailBottomSnapshot === null) atBottomRef.current = atBottom
      return isTailAppend && ((isNewTailAppend && latestRecoveryRef.current) || canFollowLatest(atBottom))
        ? 'smooth'
        : false
    },
    [canFollowLatest, isNewTailAppend, isTailAppend, tailBottomSnapshot]
  )

  const handleFollowLatest = useCallback(() => {
    manualScrollIntentRef.current = false
    manualScrollActiveRef.current = false
    manualScrollPausedRef.current = false
    manualScrollDownRef.current = false
    pendingProgrammaticScrollRef.current = null
    cancelHeadRebaseTransaction()
    latestRecoveryRef.current = true
    clearInitialScrollCancellation()
    clearHeadAnchor()
    clearNewMessageCount()
    updateViewportActionState()
    runScrollCommand({ command: 'follow-latest' })
  }, [
    cancelHeadRebaseTransaction,
    clearHeadAnchor,
    clearInitialScrollCancellation,
    clearNewMessageCount,
    runScrollCommand,
    updateViewportActionState
  ])

  useLayoutEffect(() => {
    if (localSendToken <= lastLocalSendTokenRef.current) return

    lastLocalSendTokenRef.current = localSendToken
    handleFollowLatest()
  }, [handleFollowLatest, localSendToken])

  const displayedNewMessageCount = Math.min(newMessageCount, 99)
  const hasNewMessages = newMessageCount > 0
  const followActionLabel = hasNewMessages
    ? `${newMessageCount > 99 ? '99+' : newMessageCount} new message${newMessageCount === 1 ? '' : 's'}`
    : 'Scroll to latest messages'
  const isFollowActionVisible =
    hasChildren &&
    scrollParentRef !== null &&
    !viewportActionState.isAtBottom &&
    viewportActionState.isBeyondHalfScreen &&
    !viewportActionState.isManualScrollDown

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
            totalListHeightChanged={handleTotalListHeightChanged}
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
      {hasChildren && scrollParentRef ? (
        <button
          type="button"
          aria-label={followActionLabel}
          title={followActionLabel}
          aria-hidden={!isFollowActionVisible}
          data-state={isFollowActionVisible ? 'open' : 'closed'}
          data-testid="follow-latest-action"
          disabled={!isFollowActionVisible}
          tabIndex={isFollowActionVisible ? 0 : -1}
          className={cn(
            'bg-secondary absolute bottom-3 left-1/2 z-10 grid h-7 -translate-x-1/2 items-center overflow-hidden rounded-full text-xs font-medium text-slate-500 shadow-sm transition-[opacity,grid-template-columns,gap,padding] duration-200 ease-out hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none disabled:cursor-default dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
            hasNewMessages ? 'grid-cols-[auto_1fr] gap-x-1.5 px-2' : 'grid-cols-[auto_0fr] gap-x-0 px-1.5',
            isFollowActionVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
          onClick={handleFollowLatest}
        >
          <ArrowDownIcon size={14} aria-hidden="true" />
          {hasNewMessages ? (
            <span className="min-w-0 overflow-hidden text-xs whitespace-nowrap">
              {import.meta.env.FIREFOX ? (
                <span className="tabular-nums">
                  {displayedNewMessageCount}
                  {newMessageCount > 99 ? '+' : ''}
                </span>
              ) : (
                <span className="inline-flex tabular-nums">
                  <NumberFlow value={displayedNewMessageCount} />
                  {newMessageCount > 99 ? '+' : null}
                </span>
              )}{' '}
              {newMessageCount === 1 ? 'new message' : 'new messages'}
            </span>
          ) : null}
        </button>
      ) : null}
    </div>
  )
}

MessageList.displayName = 'MessageList'

export default MessageList
