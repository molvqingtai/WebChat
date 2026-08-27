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
import { useRemeshDomain, useRemeshEvent } from 'remesh-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { HistorySyncCompletedEvent } from '@/domain/externs/ChatRoom'
import ChatRoomDomain from '@/domain/ChatRoom'
import { cn } from '@/utils'

export interface MessageListProps {
  children?: ReactElement[] | null
  historySyncIntent?: HistorySyncCompletedEvent | null
  onHistorySyncIntentConsumed?: (syncId: string) => void
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
  | { command: 'follow-bottom' }
  | { command: 'follow-latest'; index: number }
  | { command: 'head-rebase'; index: number; offset: number }
  | { command: 'tail-restore'; index: number; offset: number }

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
}

type TailBottomSnapshot = {
  anchor: HeadAnchor | null
  atBottom: boolean
  callbackPending: boolean
  follow: boolean
  itemKeys: readonly string[]
  restore: 'pending' | 'commanded' | null
  scrollPending: boolean
  viewport: HTMLElement
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

const getViewportActionState = (scrollParent: HTMLElement, isAtBottom: boolean): ViewportActionState => {
  const distanceFromBottom = Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight - scrollParent.scrollTop)
  return {
    isAtBottom,
    isBeyondHalfScreen: scrollParent.clientHeight > 0 && distanceFromBottom > scrollParent.clientHeight * 0.5
  }
}

const getPhysicalViewportActionState = (scrollParent: HTMLElement): ViewportActionState => {
  const { clientHeight, scrollHeight, scrollTop } = scrollParent
  const distanceFromBottom = Math.max(0, scrollHeight - clientHeight - scrollTop)
  return {
    isAtBottom: scrollTop + clientHeight >= scrollHeight - 1,
    isBeyondHalfScreen: clientHeight > 0 && distanceFromBottom > clientHeight * 0.5
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

const MessageList: FC<MessageListProps> = ({ children, historySyncIntent = null, onHistorySyncIntentConsumed }) => {
  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const [scrollParentRef, setScrollParentRef] = useState<HTMLDivElement | null>(null)
  const [initialTopMostItemIndex, setInitialTopMostItemIndex] = useState<
    typeof INITIAL_TOP_MOST_ITEM_INDEX | undefined
  >(INITIAL_TOP_MOST_ITEM_INDEX)
  const [viewportActionState, setViewportActionState] = useState<ViewportActionState>({
    isAtBottom: true,
    isBeyondHalfScreen: false
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
  const pendingProgrammaticScrollRef = useRef<PendingProgrammaticScroll | null>(null)
  const currentItemKeysRef = useRef<readonly string[]>([])
  const activeViewportRef = useRef<HTMLElement | null>(null)
  const initialScrollCancellationEligibleRef = useRef(true)
  const initialScrollCancellationPendingRef = useRef(false)
  const initialScrollCancellationPassedHeadRef = useRef(false)
  const headAnchorRef = useRef<HeadAnchor | null>(null)
  const headRebaseTransactionRef = useRef<HeadRebaseTransaction | null>(null)
  const tailBottomSnapshotRef = useRef<TailBottomSnapshot | null>(null)
  const latestRecoveryRef = useRef(false)
  const newMessageCountRef = useRef(0)
  const lastHistorySyncIntentRef = useRef<string | null>(null)
  const localSendFrameRef = useRef<number | null>(null)
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

  const cancelTailBottomSnapshot = useCallback((snapshot?: TailBottomSnapshot | null) => {
    if (snapshot !== undefined && tailBottomSnapshotRef.current !== snapshot) return
    tailBottomSnapshotRef.current = null
  }, [])

  const isCurrentTailBottomSnapshot = useCallback(
    (snapshot: TailBottomSnapshot) =>
      tailBottomSnapshotRef.current === snapshot &&
      snapshot.viewport === scrollParentRef &&
      hasSameItems(currentItemKeysRef.current, snapshot.itemKeys),
    [scrollParentRef]
  )

  const canFollowLatest = useCallback(
    (atBottom: boolean) =>
      atBottom &&
      !latestRecoveryRef.current &&
      !manualScrollIntentRef.current &&
      !manualScrollActiveRef.current &&
      !manualScrollPausedRef.current,
    []
  )

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

    const tailBottomSnapshot = tailBottomSnapshotRef.current
    if (!hasChildren || !scrollParentRef || tailBottomSnapshot?.viewport !== scrollParentRef) {
      cancelTailBottomSnapshot()
    } else if (tailBottomSnapshot) {
      const ownerUpdate = getChildUpdate(tailBottomSnapshot.itemKeys, itemKeys)
      if (ownerUpdate.update === 'replace') {
        cancelTailBottomSnapshot(tailBottomSnapshot)
      } else {
        tailBottomSnapshot.itemKeys = itemKeys
      }
    }

    currentItemKeysRef.current = itemKeys
    activeViewportRef.current = scrollParentRef

    if (isTailAppend && scrollParentRef) {
      const atBottom = isViewportAtBottom(scrollParentRef)
      const follow = canFollowLatest(atBottom)
      const snapshot = {
        anchor: follow ? null : getHeadAnchor(scrollParentRef, previousItemKeysRef.current ?? itemKeys),
        atBottom,
        callbackPending: true,
        follow,
        itemKeys,
        restore: null,
        scrollPending: true,
        viewport: scrollParentRef
      }
      tailBottomSnapshotRef.current = snapshot
    }

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
  }, [
    cancelHeadRebaseTransaction,
    cancelTailBottomSnapshot,
    canFollowLatest,
    childUpdate.update,
    hasChildren,
    headRebaseTarget,
    isTailAppend,
    itemKeys,
    scrollParentRef
  ])

  useLayoutEffect(() => () => cancelHeadRebaseTransaction(), [cancelHeadRebaseTransaction])
  useLayoutEffect(() => () => cancelTailBottomSnapshot(), [cancelTailBottomSnapshot])

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
          ? getViewportActionState(scrollParentRef, actionStateOrAtBottom)
          : actionStateOrAtBottom
      setViewportActionState((currentState) =>
        currentState.isAtBottom === nextState.isAtBottom &&
        currentState.isBeyondHalfScreen === nextState.isBeyondHalfScreen
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
          handle.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
          return
        case 'follow-latest':
          handle.scrollToIndex({ index: command.index, align: 'end', behavior: 'smooth' })
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
          return
        case 'tail-restore':
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

    updateViewportActionState(atBottomRef.current)
  }, [scrollParentRef, updateViewportActionState])

  useLayoutEffect(() => {
    if (isNewTailAppend) {
      lastTailItemKeysRef.current = itemKeys
      const atBottom = tailBottomSnapshotRef.current?.atBottom ?? atBottomRef.current
      atBottomRef.current = atBottom
      if (latestRecoveryRef.current) {
        clearNewMessageCount()
      } else {
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
      cancelHeadRebaseTransaction()
      cancelTailBottomSnapshot()
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
      const pendingProgrammaticScroll = pendingProgrammaticScrollRef.current
      if (pendingProgrammaticScroll?.viewport === scrollParentRef) {
        const transaction = pendingProgrammaticScroll.owner

        if (
          !isCurrentHeadRebaseTransaction(transaction) ||
          !hasSameItems(itemKeys, transaction.itemKeys) ||
          transaction.phase !== 'pending' ||
          !hasHeadRebaseTarget(transaction)
        ) {
          return
        }
        pendingProgrammaticScrollRef.current = null
        cancelHeadRebaseTransaction(transaction)
        const finalActionState = getPhysicalViewportActionState(scrollParentRef)
        atBottomRef.current = finalActionState.isAtBottom
        updateViewportActionState(finalActionState)
        return
      }

      if (!isCurrentListCallback()) return
      if (headRebaseTransactionRef.current) return

      promoteManualScroll()
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
    cancelTailBottomSnapshot,
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
    (reportedAtBottom: boolean, settledAtBottom?: boolean) => {
      const tailBottomSnapshot = tailBottomSnapshotRef.current
      if (!isCurrentListCallback()) return
      if (headRebaseTransactionRef.current) return
      if (
        tailBottomSnapshot &&
        !tailBottomSnapshot.follow &&
        (tailBottomSnapshot.callbackPending || tailBottomSnapshot.scrollPending) &&
        !tailBottomSnapshot.atBottom &&
        isCurrentTailBottomSnapshot(tailBottomSnapshot)
      ) {
        return
      }
      const atBottom = settledAtBottom ?? (scrollParentRef ? isViewportAtBottom(scrollParentRef) : reportedAtBottom)
      if (
        tailBottomSnapshot &&
        !tailBottomSnapshot.follow &&
        isCurrentTailBottomSnapshot(tailBottomSnapshot) &&
        tailBottomSnapshot.restore
      ) {
        if (tailBottomSnapshot.restore === 'pending' && atBottom) {
          const anchor = tailBottomSnapshot.anchor
          if (!anchor || itemKeys[anchor.index] !== anchor.key) {
            cancelTailBottomSnapshot(tailBottomSnapshot)
          } else {
            tailBottomSnapshot.restore = 'commanded'
            runScrollCommand({ command: 'tail-restore', index: anchor.index, offset: anchor.offset })
            return
          }
        } else if (tailBottomSnapshot.restore === 'commanded') {
          if (atBottom) return

          cancelTailBottomSnapshot(tailBottomSnapshot)
          atBottomRef.current = false
          updateViewportActionState(false)
          return
        }
      }
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
      updateViewportActionState(true)
      if (manualScrollActiveRef.current) return
    },
    [
      acknowledgeManualDeparture,
      cancelLatestRecovery,
      clearHeadAnchor,
      clearInitialScrollCancellation,
      clearNewMessageCount,
      cancelTailBottomSnapshot,
      isCurrentListCallback,
      isCurrentTailBottomSnapshot,
      itemKeys,
      runScrollCommand,
      scrollParentRef,
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
        updateViewportActionState()
        return
      }

      manualScrollActiveRef.current = false
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
    const tailBottomSnapshot = tailBottomSnapshotRef.current
    const hasCurrentTailBottomSnapshot =
      tailBottomSnapshot !== null &&
      (tailBottomSnapshot.callbackPending || tailBottomSnapshot.scrollPending) &&
      isCurrentTailBottomSnapshot(tailBottomSnapshot)
    const headRebaseTransaction = headRebaseTransactionRef.current
    const settleTailBottomSnapshot = (actionState: ViewportActionState) => {
      if (!tailBottomSnapshot || !hasCurrentTailBottomSnapshot || !tailBottomSnapshot.callbackPending) return

      tailBottomSnapshot.callbackPending = false
      if (latestRecoveryRef.current) {
        return
      }
      if (headRebaseTransactionRef.current) {
        atBottomRef.current = actionState.isAtBottom
        return
      }
      handleAtBottomStateChange(actionState.isAtBottom, actionState.isAtBottom)
    }

    if (headRebaseTransaction) {
      if (!isCurrentHeadRebaseTransaction(headRebaseTransaction)) return
      if (headRebaseTransaction.phase === 'registered') {
        if (hasHeadRebaseTarget(headRebaseTransaction)) {
          const finalActionState = getPhysicalViewportActionState(scrollParentRef)
          atBottomRef.current = finalActionState.isAtBottom
          cancelHeadRebaseTransaction(headRebaseTransaction)
          updateViewportActionState(finalActionState)
          settleTailBottomSnapshot(finalActionState)
          return
        }
        runScrollCommand(
          { command: 'head-rebase', index: headRebaseTransaction.index, offset: headRebaseTransaction.offset },
          headRebaseTransaction
        )
      }
      if (hasCurrentTailBottomSnapshot) {
        settleTailBottomSnapshot(getPhysicalViewportActionState(scrollParentRef))
      }
      return
    }

    if (hasCurrentTailBottomSnapshot) {
      settleTailBottomSnapshot(getPhysicalViewportActionState(scrollParentRef))
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
    cancelTailBottomSnapshot,
    handleAtBottomStateChange,
    isCurrentHeadRebaseTransaction,
    isCurrentListCallback,
    isCurrentTailBottomSnapshot,
    runScrollCommand,
    scrollParentRef,
    updateViewportActionState
  ])

  const handleScrollIntoViewOnChange = useCallback(
    ({ totalCount }: { totalCount: number }) => {
      const tailBottomSnapshot = tailBottomSnapshotRef.current
      if (
        !tailBottomSnapshot ||
        !tailBottomSnapshot.scrollPending ||
        totalCount !== itemKeys.length ||
        !isCurrentTailBottomSnapshot(tailBottomSnapshot)
      ) {
        return false
      }

      tailBottomSnapshot.scrollPending = false
      if (latestRecoveryRef.current || tailBottomSnapshot.follow) {
        return { index: totalCount - 1, align: 'end' as const, behavior: 'auto' as const }
      }

      const anchor = tailBottomSnapshot.anchor
      if (anchor && itemKeys[anchor.index] === anchor.key) tailBottomSnapshot.restore = 'pending'
      return false
    },
    [isCurrentTailBottomSnapshot, itemKeys.length]
  )

  const handleFollowLatest = useCallback(() => {
    manualScrollIntentRef.current = false
    manualScrollActiveRef.current = false
    manualScrollPausedRef.current = false
    pendingProgrammaticScrollRef.current = null
    cancelHeadRebaseTransaction()
    latestRecoveryRef.current = true
    clearInitialScrollCancellation()
    clearHeadAnchor()
    clearNewMessageCount()
    updateViewportActionState()
    const index = currentItemKeysRef.current.length - 1
    if (index >= 0) runScrollCommand({ command: 'follow-latest', index })
  }, [
    cancelHeadRebaseTransaction,
    clearHeadAnchor,
    clearInitialScrollCancellation,
    clearNewMessageCount,
    runScrollCommand,
    updateViewportActionState
  ])

  useRemeshEvent(chatRoomDomain.event.SendTextMessageEvent, () => {
    if (localSendFrameRef.current !== null) cancelAnimationFrame(localSendFrameRef.current)
    localSendFrameRef.current = requestAnimationFrame(() => {
      localSendFrameRef.current = null
      handleFollowLatest()
    })
  })

  useLayoutEffect(
    () => () => {
      if (localSendFrameRef.current === null) return
      cancelAnimationFrame(localSendFrameRef.current)
      localSendFrameRef.current = null
    },
    []
  )

  useLayoutEffect(() => {
    if (!historySyncIntent || !hasChildren || !scrollParentRef) return

    const key = historySyncIntent.syncId
    if (lastHistorySyncIntentRef.current === key) return

    lastHistorySyncIntentRef.current = key
    onHistorySyncIntentConsumed?.(key)
    if (isViewportAtBottom(scrollParentRef)) {
      handleAtBottomStateChange(true, true)
      return
    }
    handleFollowLatest()
  }, [
    handleAtBottomStateChange,
    handleFollowLatest,
    hasChildren,
    historySyncIntent,
    onHistorySyncIntentConsumed,
    scrollParentRef
  ])

  const displayedNewMessageCount = Math.min(newMessageCount, 99)
  const hasNewMessages = newMessageCount > 0
  const followActionLabel = hasNewMessages
    ? `${newMessageCount > 99 ? '99+' : newMessageCount} new message${newMessageCount === 1 ? '' : 's'}`
    : 'Scroll to latest messages'
  const isFollowActionVisible =
    hasChildren && scrollParentRef !== null && !viewportActionState.isAtBottom && viewportActionState.isBeyondHalfScreen

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
            scrollIntoViewOnChange={handleScrollIntoViewOnChange}
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
