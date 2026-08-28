import { cleanup, render } from 'vitest-browser-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReactElement } from 'react'
import '@/assets/styles/tailwind.css'
import { MESSAGE_RECORD_TYPE, NOTICE_TYPE, type SystemNoticeMessage } from '@/domain/Message'
import MessageList from './message-list'
import NoticeGroup from './notice-group'

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const row = (id: string, height: number): ReactElement => (
  <div data-testid={`message-${id}`} key={id} style={{ boxSizing: 'border-box', height, padding: '8px' }}>
    Message {id}
  </div>
)
const history = (count: number) =>
  Array.from({ length: count }, (_, index) => row(String(index), index % 4 === 0 ? 156 : 56 + (index % 3) * 24))
const noticeUser = { id: 'notice-user', name: 'Notice user', avatar: '' }
const notice = (id: string, timestamp: number): SystemNoticeMessage => ({
  type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
  id,
  hlc: { timestamp, counter: 0 },
  receivedAt: timestamp,
  user: noticeUser,
  body: id,
  noticeType: NOTICE_TYPE.INFO
})
const groupedRow = (
  <NoticeGroup
    key="notice-group"
    notices={[notice('Grouped older notice', 1), notice('Grouped latest notice', 2)]}
    last
  />
)
const harness = (historyReady: boolean, children: ReactElement[]) => (
  <div style={{ display: 'grid', gridTemplateRows: '1fr', height: '240px', width: '360px' }}>
    <MessageList>{historyReady ? children : null}</MessageList>
  </div>
)
const viewport = () => document.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')!
const content = () => document.querySelector<HTMLElement>('[data-slot="message-scroller-content"]')
const followAction = () => document.querySelector<HTMLElement>('[data-testid="follow-latest-action"]')
const atBottom = (element: HTMLElement) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1
type ScrollCall = { behavior?: ScrollBehavior; top?: number }

// The scroller viewport mounts together with its content, so scroll commands can only be
// observed through the shared prototype before the first content commit.
const recordScrollCommands = () => {
  const calls: ScrollCall[] = []
  const original = Element.prototype.scrollTo
  Element.prototype.scrollTo = function (this: Element, ...args: [ScrollToOptions] | [number, number]) {
    const first = args[0]
    calls.push(typeof first === 'object' ? { ...first } : { top: first })
    // Smooth commands still prove intent through the recording; apply them instantly so the
    // geometry assertions stay deterministic.
    if (typeof first === 'object') {
      return Reflect.apply(original, this, [{ ...first, behavior: 'auto' }])
    }
    return Reflect.apply(original, this, args)
  } as typeof Element.prototype.scrollTo
  return calls
}

const originalScrollTo = Element.prototype.scrollTo
const suppressResizeObserverLoop = (event: ErrorEvent) => {
  if (event.message === 'ResizeObserver loop completed with undelivered notifications.') event.preventDefault()
}

beforeEach(() => window.addEventListener('error', suppressResizeObserverLoop))
afterEach(() => {
  Element.prototype.scrollTo = originalScrollTo
  window.removeEventListener('error', suppressResizeObserverLoop)
  cleanup()
})

describe('MessageList initial settlement', () => {
  it('first presents overflowing variable-height history at the end without a smooth settlement scroll', async () => {
    const rows = [...history(23), groupedRow]
    const view = await render(harness(false, rows))

    // Constant shell: viewport/content are mounted during loading; only rows wait for content.
    expect(viewport()).not.toBeNull()
    expect(document.querySelectorAll('[data-slot="message-scroller-item"]')).toHaveLength(0)

    const calls = recordScrollCommands()

    const visibleOffsets: number[] = []
    let sampling = true
    const sample = () => {
      // Sample only once rows exist: the constant empty shell is trivially bottomed and is
      // not part of the settlement surface under test.
      if (document.querySelector('[data-slot="message-scroller-item"]')) visibleOffsets.push(viewport().scrollTop)
      if (sampling) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)

    await view.rerender(harness(true, rows))
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Grouped latest notice')
      expect(document.body.textContent).not.toContain('Grouped older notice')
      expect(atBottom(viewport())).toBe(true)
      expect(visibleOffsets.length).toBeGreaterThan(0)
    })
    sampling = false

    const scrollParent = viewport()
    expect(visibleOffsets.every((offset) => offset + scrollParent.clientHeight >= scrollParent.scrollHeight - 1)).toBe(
      true
    )
    expect(calls.some((call) => call.behavior === 'smooth')).toBe(false)
  })

  it('follows an append when the user is already at the bottom', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
    scrollParent.dispatchEvent(new Event('scroll'))
    await frame()
    await frame()

    // Exact follow semantics: one smooth end command for the new tail, then a physically
    // settled bottom. Pixel-monotonic proxies are not asserted: intrinsic reserves converting
    // to real row heights legitimately move absolute offsets.
    const calls = recordScrollCommands()
    await view.rerender(harness(true, [...initialRows, row('bottom-append', 72)]))
    await vi.waitFor(
      () => {
        expect(document.querySelector('[data-testid="message-bottom-append"]')).not.toBeNull()
        expect(calls.some((call) => call.behavior === 'smooth')).toBe(true)
        expect(atBottom(scrollParent)).toBe(true)
      },
      { timeout: 5000 }
    )
    expect(followAction()?.getAttribute('data-state')).toBe('closed')
  })

  it('preserves a non-bottom reading position when a message arrives', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="message-23"]')).not.toBeNull()
      expect(atBottom(scrollParent)).toBe(true)
    })
    await frame()
    await frame()

    scrollParent.scrollTo({ top: 0, behavior: 'auto' })
    await vi.waitFor(() => {
      expect(scrollParent.scrollTop).toBe(0)
      expect(document.querySelector('[data-testid="message-0"]')).not.toBeNull()
    })
    await frame()
    await frame()

    // Exact preservation semantics: the new row exists and the reading offset is untouched.
    // Absolute scroll-height deltas are not asserted because intrinsic reserves convert to
    // real row heights independently of the reading position.
    await view.rerender(harness(true, [...initialRows, row('history-append', 88)]))
    await vi.waitFor(() => expect(document.querySelector('[data-testid="message-history-append"]')).not.toBeNull())
    await frame()
    await frame()

    expect(scrollParent.scrollTop).toBe(0)
  })

  it('first presents a non-empty short history at its natural position without a settlement scroll', async () => {
    const rows = [row('short-first', 48), row('short-latest', 64)]
    const view = await render(harness(false, rows))

    // Constant shell: only rows wait for content.
    expect(viewport()).not.toBeNull()
    expect(document.querySelectorAll('[data-slot="message-scroller-item"]')).toHaveLength(0)

    const calls = recordScrollCommands()

    const visibleOffsets: number[] = []
    let sampling = true
    const sample = () => {
      if (content()) visibleOffsets.push(viewport().scrollTop)
      if (sampling) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)

    await view.rerender(harness(true, rows))
    await vi.waitFor(() => {
      const first = document.querySelector<HTMLElement>('[data-testid="message-short-first"]')
      const latest = document.querySelector<HTMLElement>('[data-testid="message-short-latest"]')
      const viewportBounds = viewport().getBoundingClientRect()
      expect(first).not.toBeNull()
      expect(latest).not.toBeNull()
      expect(Math.abs(first!.getBoundingClientRect().top - viewportBounds.top)).toBeLessThan(1)
      expect(latest!.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewportBounds.bottom)
      expect(visibleOffsets.length).toBeGreaterThan(0)
    })
    sampling = false

    expect(visibleOffsets.every((offset) => offset === 0)).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('mounts loaded empty history once and accepts its first append without replacement', async () => {
    const view = await render(harness(true, []))
    await vi.waitFor(() => expect(content()).not.toBeNull())
    const mountedContent = content()

    await view.rerender(harness(true, [row('first', 48)]))
    await vi.waitFor(() => expect(document.querySelector('[data-testid="message-first"]')).not.toBeNull())

    expect(content()).toBe(mountedContent)
    expect(atBottom(viewport())).toBe(true)
  })
})

describe('MessageList follow and recovery', () => {
  it('counts off-bottom arrivals and recovers to the latest tail on action click', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
    await frame()
    await frame()

    scrollParent.scrollTo({ top: 0, behavior: 'auto' })
    await vi.waitFor(() => expect(scrollParent.scrollTop).toBe(0))
    await frame()
    await frame()

    await view.rerender(harness(true, [...initialRows, row('n1', 72)]))
    await vi.waitFor(() => expect(followAction()?.getAttribute('data-state')).toBe('open'))
    expect(followAction()?.getAttribute('aria-label')).toBe('1 new message')
    expect(scrollParent.scrollTop).toBe(0)

    await view.rerender(harness(true, [...initialRows, row('n1', 72), row('n2', 88)]))
    await vi.waitFor(() => expect(followAction()?.getAttribute('aria-label')).toBe('2 new messages'))
    expect(scrollParent.scrollTop).toBe(0)

    followAction()!.click()
    await vi.waitFor(
      () => {
        expect(atBottom(scrollParent)).toBe(true)
        expect(followAction()?.getAttribute('data-state')).toBe('closed')
      },
      { timeout: 5000 }
    )
  })

  it('treats a wheel departure as manual and clears the count when the user returns to the bottom', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
    await frame()
    await frame()

    scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    scrollParent.scrollTo({ top: scrollParent.scrollTop - 120, behavior: 'auto' })
    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(false))
    await frame()
    await frame()

    await view.rerender(harness(true, [...initialRows, row('wheel-append', 72)]))
    await vi.waitFor(() => expect(followAction()?.getAttribute('aria-label')).toBe('1 new message'))
    expect(atBottom(scrollParent)).toBe(false)

    scrollParent.scrollTo({ top: scrollParent.scrollHeight, behavior: 'auto' })
    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
    await frame()
    await frame()

    await vi.waitFor(() => expect(followAction()?.getAttribute('data-state')).toBe('closed'))
  })

  it('preserves the reading anchor when history is prepended', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
    scrollParent.scrollTo({ top: 0, behavior: 'auto' })
    await vi.waitFor(() => expect(scrollParent.scrollTop).toBe(0))
    await frame()
    await frame()
    const anchor = document.querySelector<HTMLElement>('[data-testid="message-0"]')!
    const anchorTopBeforePrepend = anchor.getBoundingClientRect().top

    const olderRows = Array.from({ length: 8 }, (_, index) => row(`older-${index}`, 64 + (index % 3) * 32))
    await view.rerender(harness(true, [...olderRows, ...initialRows]))
    await vi.waitFor(() => expect(document.querySelector('[data-testid="message-older-0"]')).not.toBeNull())
    await frame()
    await frame()

    expect(scrollParent.scrollTop).toBeGreaterThan(0)
    expect(Math.abs(anchor.getBoundingClientRect().top - anchorTopBeforePrepend)).toBeLessThan(2)
    expect(followAction()?.getAttribute('aria-label')).toBe('Scroll to latest messages')
  })

  it('follows repeated tail appends while settled at the bottom', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))

    let rows = initialRows
    for (const id of ['repeat-1', 'repeat-2', 'repeat-3']) {
      rows = [...rows, row(id, 72)]
      await view.rerender(harness(true, rows))
      await vi.waitFor(
        () => {
          expect(document.querySelector(`[data-testid="message-${id}"]`)).not.toBeNull()
          expect(atBottom(scrollParent)).toBe(true)
        },
        { timeout: 5000 }
      )
    }
    expect(followAction()?.getAttribute('data-state')).toBe('closed')
  })

  it('mounts a long history as real DOM and settles at the end within a bounded budget', async () => {
    const startedAt = performance.now()
    const rows = history(800)
    await render(harness(true, rows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true), { timeout: 5000 })
    const elapsed = performance.now() - startedAt

    expect(document.querySelectorAll('[data-slot="message-scroller-item"]')).toHaveLength(800)
    // Real-geometry bound: 800 variable-height rows (56..156px real, 104px intrinsic reserve
    // for unrendered rows) must produce a scroll height inside this envelope.
    expect(scrollParent.scrollHeight).toBeGreaterThan(800 * 40)
    expect(scrollParent.scrollHeight).toBeLessThan(800 * 170)
    expect(elapsed).toBeLessThan(5000)
  })

  it('exposes region/log a11y semantics and keeps follow behavior after keyboard scroll intent', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))

    expect(scrollParent.getAttribute('role')).toBe('region')
    expect(scrollParent.getAttribute('aria-label')).toBe('Messages')
    expect(scrollParent.tabIndex).toBe(0)
    expect(content()?.getAttribute('role')).toBe('log')
    expect(content()?.getAttribute('aria-relevant')).toBe('additions')
    const firstItem = document.querySelector<HTMLElement>('[data-slot="message-scroller-item"]')!
    expect(getComputedStyle(firstItem).contentVisibility).toBe('auto')
    // Stable intrinsic fallback for variable-height rows (104px, selected by real-browser CSS
    // matrix evidence); `auto` keeps post-measurement layout real.
    expect(getComputedStyle(firstItem).containIntrinsicSize).toContain('104px')

    scrollParent.focus()
    expect(document.activeElement).toBe(scrollParent)
    // Downward keys at the bottom must not corrupt follow state.
    for (const key of ['ArrowDown', 'End', 'PageDown']) {
      scrollParent.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }
    await frame()
    await frame()

    await view.rerender(harness(true, [...initialRows, row('after-keys', 72)]))
    await vi.waitFor(
      () => {
        expect(document.querySelector('[data-testid="message-after-keys"]')).not.toBeNull()
        expect(atBottom(scrollParent)).toBe(true)
      },
      { timeout: 5000 }
    )
  })
})

describe('MessageList authorized follow and sole scroll ownership (acceptance repair)', () => {
  it('settles at the physical bottom when a reserved tail row renders taller than the intrinsic fallback during the smooth follow', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
    await frame()
    await frame()

    // Native smooth motion without command interception: the appended 140px row starts
    // skipped with the 104px intrinsic reserve and becomes real while the smooth follow is
    // traveling. The authorized follow must retarget/reconcile to the settled physical bottom
    // instead of completing at the stale reserve target and latching the counter on.
    await view.rerender(harness(true, [...initialRows, row('growing-append', 140)]))
    await vi.waitFor(
      () => {
        expect(document.querySelector('[data-testid="message-growing-append"]')).not.toBeNull()
        expect(atBottom(scrollParent)).toBe(true)
      },
      { timeout: 5000 }
    )
    expect(followAction()?.getAttribute('data-state')).toBe('closed')
  })

  it('exposes a single repository shadcn ScrollArea viewport as the engine geometry/command owner', async () => {
    const initialRows = history(24)
    await render(harness(true, initialRows))
    await vi.waitFor(() => expect(document.querySelector('[data-testid="message-23"]')).not.toBeNull(), {
      timeout: 5000
    })

    // Exactly one repository ScrollArea viewport carries the engine viewport identity/state;
    // no native or nested second overflow owner exists. The repository ScrollBar follows the
    // Radix hover model, mounting on real scroll/hover of the scroll area.
    const radixOwners = [...document.querySelectorAll<HTMLElement>('[data-radix-scroll-area-viewport]')]
    expect(radixOwners).toHaveLength(1)
    const owner = radixOwners[0]
    expect(owner.getAttribute('data-slot')).toContain('message-scroller-viewport')
    expect(owner.getAttribute('role')).toBe('region')
    expect(owner.getAttribute('aria-label')).toBe('Messages')

    const scrollerRoot = document.querySelector<HTMLElement>('[data-slot="message-scroller"]')!
    const nestedOwners = [...scrollerRoot.querySelectorAll<HTMLElement>('*')].filter((element) => {
      if (element === owner) return false
      const overflowY = getComputedStyle(element).overflowY
      return (overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight
    })
    expect(nestedOwners).toHaveLength(0)

    owner.scrollTop = 100
    owner.dispatchEvent(new Event('scroll', { bubbles: true }))
    owner.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
    await vi.waitFor(() => expect(document.querySelector('[data-slot="scroll-area-scrollbar"]')).not.toBeNull(), {
      timeout: 5000
    })
  })

  it('retargets the current authorization when a second tail lands while the follow is traveling', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
    await frame()
    await frame()

    // The second append commits while the first follow is still traveling; the same current
    // authorization must retarget to the newer tail (including its reserve-to-real growth).
    await view.rerender(harness(true, [...initialRows, row('first-tail', 72)]))
    await view.rerender(harness(true, [...initialRows, row('first-tail', 72), row('second-tail', 140)]))
    await vi.waitFor(
      () => {
        expect(document.querySelector('[data-testid="message-second-tail"]')).not.toBeNull()
        expect(atBottom(scrollParent)).toBe(true)
      },
      { timeout: 5000 }
    )
    expect(followAction()?.getAttribute('data-state')).toBe('closed')
  })

  it('does not cancel the authorized follow on programmatic scroll events', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
    await frame()
    await frame()

    await view.rerender(harness(true, [...initialRows, row('programmatic-tail', 140)]))
    // Bare scroll events carry no user intent; the authorized follow must still settle.
    scrollParent.dispatchEvent(new Event('scroll'))
    await vi.waitFor(
      () => {
        expect(document.querySelector('[data-testid="message-programmatic-tail"]')).not.toBeNull()
        expect(atBottom(scrollParent)).toBe(true)
      },
      { timeout: 5000 }
    )
    expect(followAction()?.getAttribute('data-state')).toBe('closed')
  })

  it('cancels the authorized follow on real wheel, touch, navigation-key, or scrollbar-drag intent', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
    await frame()
    await frame()

    const cancelIntents: Array<{ name: string; dispatch: () => void | Promise<void> }> = [
      {
        name: 'wheel',
        dispatch: () => {
          scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true }))
        }
      },
      {
        name: 'touch',
        dispatch: () => {
          scrollParent.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true }))
        }
      },
      {
        name: 'navigation-key',
        dispatch: () => {
          scrollParent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
        }
      },
      {
        name: 'scrollbar-drag',
        dispatch: async () => {
          // The repository Radix ScrollBar follows the hover model: it is absent at rest and
          // mounts on real scroll/hover with a hide delay. Prove the full path — deterministically
          // reach the no-mounted-scrollbar state first (a preceding follow's scroll-hide window may
          // still be active), then hold an outstanding authorized follow, real overflow,
          // hover-mount, and a drag on its actual thumb descendant. The delegated root listener
          // (production) is the only thing that can cancel here; without it this control fails.
          await vi.waitFor(() => expect(document.querySelector('[data-slot="scroll-area-scrollbar"]')).toBeNull(), {
            timeout: 5000
          })
          scrollParent.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
          scrollParent.scrollTop = 100
          scrollParent.dispatchEvent(new Event('scroll', { bubbles: true }))
          await vi.waitFor(() => expect(document.querySelector('[data-slot="scroll-area-thumb"]')).not.toBeNull(), {
            timeout: 5000
          })
          document
            .querySelector('[data-slot="scroll-area-thumb"]')!
            .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
        }
      }
    ]

    for (const [index, intent] of cancelIntents.entries()) {
      // Re-settle at the bottom behind one authorized follow, then cancel it with real intent.
      followAction()?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true), { timeout: 5000 })
      await frame()

      // The 140px intent row outgrows its 104px reserve mid-travel; with the authorization
      // cancelled there is no reconciliation, so the list settles short of the bottom and the
      // next append takes the ordinary off-bottom count path.
      await view.rerender(harness(true, [...initialRows, row(`intent-${index}`, 140)]))
      await intent.dispatch()
      await view.rerender(
        harness(true, [...initialRows, row(`intent-${index}`, 140), row(`after-intent-${index}`, 72)])
      )
      initialRows.push(row(`intent-${index}`, 140), row(`after-intent-${index}`, 72))
      await vi.waitFor(() => expect(followAction()?.getAttribute('aria-label')).toBe('1 new message'), {
        timeout: 5000
      })
    }
  })

  it('does not cancel the authorized follow on benign pointer selection or clicks', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
    await frame()
    await frame()

    await view.rerender(harness(true, [...initialRows, row('pointer-tail', 140)]))
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      scrollParent.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true }))
    }
    await vi.waitFor(
      () => {
        expect(document.querySelector('[data-testid="message-pointer-tail"]')).not.toBeNull()
        expect(atBottom(scrollParent)).toBe(true)
      },
      { timeout: 5000 }
    )
    expect(followAction()?.getAttribute('data-state')).toBe('closed')
  })

  it('fences stale authorization callbacks when the semantic list is replaced mid-travel', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
    await frame()
    await frame()

    // The authorized follow for the old tail is still traveling when the room/list identity is
    // replaced; no stale settlement or retarget may command the new list, which settles on its
    // own initial end with a zero arrival count.
    await view.rerender(harness(true, [...initialRows, row('old-room-tail', 140)]))
    const roomRows = [row('room-b-1', 96), row('room-b-2', 120), row('room-b-3', 140)]
    await view.rerender(harness(true, roomRows))
    await vi.waitFor(
      () => {
        expect(document.querySelector('[data-testid="message-room-b-3"]')).not.toBeNull()
        expect(atBottom(scrollParent)).toBe(true)
      },
      { timeout: 5000 }
    )
    expect(followAction()?.getAttribute('data-state')).toBe('closed')
    expect(followAction()?.getAttribute('aria-label')).toBe('Scroll to latest messages')
  })
})
