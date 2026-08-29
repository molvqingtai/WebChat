import { useCallback, useEffect, useRef, useState, type FC, type ReactElement } from 'react'
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
// adds the chat semantics the primitive does not carry: one current follow authorization for a
// new tail while settled at the bottom, and counting off-bottom arrivals behind one recovery
// action.
//
// Authorization contract (Owner acceptance repair): an at-bottom tail append creates or updates
// the single current authorization. While it is unsettled, self-caused transient off-bottom
// geometry (the smooth motion itself, or a skipped row's intrinsic reserve converting to a
// taller real height mid-travel) can neither increment the arrival count nor cancel it. A newer
// tail commit or a native scroll event retargets only when scrollHeight/tail generation strictly
// advanced; native `scrollend` settles it: bottom retires, otherwise one deduped smooth command
// to the current max. Real input intent (wheel, touch move, navigation keys, scrollbar drag)
// cancels it; pointer/click/selection and programmatic scroll events never do. Every callback is
// fenced by the current authorization identity so a stale settlement cannot act on a newer one.
const NAV_SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '])

interface FollowAuthorization {
  tailKey: string
  lastCommandedHeight: number
}

const MessageListFollow: FC<{ itemKeys: readonly string[] }> = ({ itemKeys }) => {
  const { scrollToEnd } = useMessageScroller()
  const scrollable = useMessageScrollerScrollable()
  const atEnd = !scrollable.end
  const atEndRef = useRef(atEnd)
  const previousTailKeyRef = useRef<string | null>(itemKeys.at(-1) ?? null)
  const previousCountRef = useRef(itemKeys.length)
  const authorizationRef = useRef<FollowAuthorization | null>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const [newMessageCount, setNewMessageCount] = useState(0)
  // S1 visibility gate (Owner acceptance repair): the action is shown iff the exact bottom
  // distance exceeds 0.5 * current viewport.clientHeight. The engine's 8px edge threshold
  // keeps driving follow semantics; the arrival count is retained internally at any
  // distance and never overrides this gate.
  const [beyondScrollThreshold, setBeyondScrollThreshold] = useState(false)

  const viewportElement = useCallback(
    () =>
      actionRef.current
        ?.closest('[data-slot="message-scroller"]')
        ?.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]') ?? null,
    []
  )

  // S1 gate: exact bottom distance vs 0.5 * current viewport.clientHeight. Recomputed on
  // every commit (this effect's call), on native scroll/scrollend, and on shell/content
  // resize (the single ResizeObserver below).
  const recomputeScrollGate = useCallback(() => {
    const viewport = viewportElement()
    if (!viewport) return
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    setBeyondScrollThreshold(distance > 0.5 * viewport.clientHeight)
  }, [viewportElement])

  useEffect(() => {
    atEndRef.current = atEnd
    if (atEnd) setNewMessageCount(0)
  }, [atEnd])

  // Native listeners: settlement (`scrollend`), mid-travel retargeting on strictly advanced
  // geometry (scroll events), and real manual-intent cancellation. Exactly one app-side
  // ResizeObserver refreshes the distance gate on shell/content resize and reconciles
  // strict post-settle growth (below). No timers, frame loops, debounce, or polling are
  // involved.
  useEffect(() => {
    const root = actionRef.current?.closest<HTMLElement>('[data-slot="message-scroller"]')
    const viewport = root?.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')
    const contentElement = root?.querySelector<HTMLElement>('[data-slot="message-scroller-content"]')
    if (!viewport || !root) return

    recomputeScrollGate()

    const cancelAuthorization = () => {
      authorizationRef.current = null
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (NAV_SCROLL_KEYS.has(event.key)) cancelAuthorization()
    }
    // Scrollbar drags cancel through one delegated listener on the constantly mounted
    // scroller root: the repository Radix ScrollBar only mounts on hover/scroll, so binding
    // the scrollbar element itself at mount would miss every later drag. Only pointerdowns
    // originating inside the repository scrollbar subtree cancel; every other pointer target
    // (messages, content, viewport, selection, clicks) leaves the authorization untouched.
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest('[data-slot="scroll-area-scrollbar"]')) {
        cancelAuthorization()
      }
    }
    const retargetIfAdvanced = () => {
      const authorization = authorizationRef.current
      if (!authorization) return
      if (viewport.scrollHeight > authorization.lastCommandedHeight) {
        authorizationRef.current = { ...authorization, lastCommandedHeight: viewport.scrollHeight }
        scrollToEnd({ behavior: 'smooth' })
      }
    }
    const onScrollEnd = () => {
      const authorization = authorizationRef.current
      if (!authorization) {
        recomputeScrollGate()
        return
      }
      const settledAtBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1
      // Retire when physically bottom or when geometry no longer advances; otherwise issue the
      // one deduped reconciliation command to the current max.
      authorizationRef.current = null
      if (!settledAtBottom && viewport.scrollHeight > authorization.lastCommandedHeight) {
        authorizationRef.current = { ...authorization, lastCommandedHeight: viewport.scrollHeight }
        scrollToEnd({ behavior: 'smooth' })
      }
      recomputeScrollGate()
    }

    const onScroll = () => {
      retargetIfAdvanced()
      recomputeScrollGate()
    }

    viewport.addEventListener('wheel', cancelAuthorization, { passive: true })
    viewport.addEventListener('touchmove', cancelAuthorization, { passive: true })
    viewport.addEventListener('keydown', onKeyDown)
    viewport.addEventListener('scroll', onScroll, { passive: true })
    viewport.addEventListener('scrollend', onScrollEnd)
    root.addEventListener('pointerdown', onPointerDown)

    // Exactly one app-side ResizeObserver (S2). Besides refreshing the gate, it reconciles
    // a strict post-settle scrollHeight growth with one deduped auto end command, but only
    // while bottom-follow continuity is physically intact: the position must sit at the
    // previous bottom (manual off-bottom reading is therefore never reclaimed, and a
    // cancelled follow that settled short is left alone), no current authorization may own
    // retargeting, and the growth must actually have moved the bottom away. The command
    // changes only scrollTop, so the callback cannot self-loop, and the dedupe ref prevents
    // a second command for the same height/tail generation.
    let lastObservedHeight = viewport.scrollHeight
    let lastReconciledHeight: number | null = null
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            recomputeScrollGate()
            const height = viewport.scrollHeight
            if (height === lastObservedHeight) return
            const wasAtBottom = viewport.scrollTop + viewport.clientHeight >= lastObservedHeight - 1
            const grew = height > lastObservedHeight
            lastObservedHeight = height
            if (
              grew &&
              authorizationRef.current === null &&
              wasAtBottom &&
              viewport.scrollTop + viewport.clientHeight < height - 1 &&
              lastReconciledHeight !== height
            ) {
              lastReconciledHeight = height
              scrollToEnd({ behavior: 'auto' })
            }
          })
    if (resizeObserver && contentElement) {
      resizeObserver.observe(viewport)
      resizeObserver.observe(contentElement)
    }

    return () => {
      viewport.removeEventListener('wheel', cancelAuthorization)
      viewport.removeEventListener('touchmove', cancelAuthorization)
      viewport.removeEventListener('keydown', onKeyDown)
      viewport.removeEventListener('scroll', onScroll)
      viewport.removeEventListener('scrollend', onScrollEnd)
      root.removeEventListener('pointerdown', onPointerDown)
      resizeObserver?.disconnect()
    }
  }, [scrollToEnd, recomputeScrollGate])

  useEffect(() => {
    recomputeScrollGate()
    const previousTailKey = previousTailKeyRef.current
    const previousCount = previousCountRef.current
    previousTailKeyRef.current = itemKeys.at(-1) ?? null
    previousCountRef.current = itemKeys.length
    const tailKey = previousTailKeyRef.current
    if (tailKey === null || tailKey === previousTailKey) return

    if (previousTailKey === null || !itemKeys.includes(previousTailKey)) {
      // The list was replaced; retire any stale authorization with the old identity.
      authorizationRef.current = null
      setNewMessageCount(0)
      if (atEndRef.current) scrollToEnd({ behavior: 'auto' })
      return
    }
    // Tail append of one or more rows.
    const added = Math.max(1, itemKeys.length - previousCount)
    if (atEndRef.current || authorizationRef.current) {
      // Create or update the single current authorization: a newer append retargets the same
      // current tail; while authorized, transient off-bottom geometry cannot count or cancel.
      setNewMessageCount(0)
      authorizationRef.current = {
        tailKey,
        lastCommandedHeight: viewportElement()?.scrollHeight ?? authorizationRef.current?.lastCommandedHeight ?? 0
      }
      scrollToEnd({ behavior: 'smooth' })
    } else {
      setNewMessageCount((count) => count + added)
    }
  }, [itemKeys, scrollToEnd, recomputeScrollGate, viewportElement])

  const actionVisible = beyondScrollThreshold
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
      ref={actionRef}
      onClick={() => {
        // Recovery is an explicit user command to the bottom, so it also carries one current
        // authorization: mid-travel reserve-to-real growth reconciles instead of latching.
        setNewMessageCount(0)
        authorizationRef.current = {
          tailKey: itemKeys.at(-1) ?? '',
          lastCommandedHeight: viewportElement()?.scrollHeight ?? 0
        }
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
