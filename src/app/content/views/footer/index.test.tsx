import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Footer from './index'

vi.mock('remesh-react', () => ({
  useRemeshSend: () => sendSpy,
  useRemeshDomain: () => fakeDomain,
  useRemeshQuery: (query: { name: string }) =>
    query.name === 'Room.CanSubmitTextQuery' ? canSubmitText : (queryFixtures[query.name] ?? null)
}))

vi.mock('@/hooks/useRoot', () => ({ default: () => null }))
vi.mock('@/hooks/useCursorPosition', () => ({
  default: () => ({ x: 0, y: 0, selectionStart: 0, selectionEnd: 0, setRef: () => {} })
}))
vi.mock('imgcap', () => ({ default: vi.fn() }))

const sendSpy = vi.fn((_action: unknown) => {})
const fakeDomain = {
  query: {
    MessageQuery: () => ({ name: 'MessageInput.ValueQuery' }),
    UserInfoQuery: () => ({ name: 'UserInfo.UserInfoQuery' }),
    UserListQuery: () => ({ name: 'Room.UserListQuery' }),
    CanSubmitTextQuery: () => ({ name: 'Room.CanSubmitTextQuery' })
  },
  command: {
    InputCommand: (value: unknown) => value,
    ClearCommand: () => 'MessageInput.ClearCommand',
    WarningCommand: () => 'Toast.WarningCommand',
    SendTextMessageCommand: (value: unknown) => value
  }
}
let canSubmitText = false
const queryFixtures: Record<string, unknown> = {
  'MessageInput.ValueQuery': 'hello',
  'UserInfo.UserInfoQuery': { id: 'local-user', name: 'Local', avatar: '' },
  'Room.UserListQuery': []
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  canSubmitText = false
})

const renderFooter = () => render(<Footer />)
const textarea = () => screen.getByRole('textbox')
const sendButton = () => screen.getByRole('button', { name: /send/i })
const submitShape = () => ({ body: 'hello', mentions: [] })

const pressEnter = (shiftKey = false) => {
  fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter', shiftKey })
}

describe('Footer @ autocomplete keyboard', () => {
  const autoCompleteUsers = [
    { id: 'user-a', name: 'alice', avatar: '' },
    { id: 'user-b', name: 'bob', avatar: '' },
    { id: 'user-c', name: 'carol', avatar: '' }
  ]
  const options = () => [...document.querySelectorAll<HTMLElement>('[data-index]')]
  const selectedClass = (element: HTMLElement) => element.className.includes('bg-accent')

  let originalScrollIntoView: typeof Element.prototype.scrollIntoView | undefined
  let scrollIntoViewSpy: ReturnType<typeof vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>>

  beforeEach(() => {
    queryFixtures['MessageInput.ValueQuery'] = '@'
    queryFixtures['Room.UserListQuery'] = autoCompleteUsers
    originalScrollIntoView = Element.prototype.scrollIntoView
    scrollIntoViewSpy = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>()
    Element.prototype.scrollIntoView = scrollIntoViewSpy
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => callback())
  })

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView!
    vi.unstubAllGlobals()
    queryFixtures['MessageInput.ValueQuery'] = 'hello'
    queryFixtures['Room.UserListQuery'] = []
  })

  const openAutoComplete = async () => {
    renderFooter()
    const input = textarea() as HTMLTextAreaElement
    input.value = '@'
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '@' }))
    await vi.waitFor(() => expect(options()).toHaveLength(3))
    expect(selectedClass(options()[0])).toBe(true)
    return input
  }

  it('opens the option list on @ and cycles selection with ArrowDown/ArrowUp, scrolling the active option into view', async () => {
    const input = await openAutoComplete()

    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' })
    expect(selectedClass(options()[1])).toBe(true)
    expect(scrollIntoViewSpy).toHaveBeenLastCalledWith({ block: 'nearest' })
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1)

    // ArrowUp wraps from index 1 through 0 to the last option.
    fireEvent.keyDown(input, { key: 'ArrowUp', code: 'ArrowUp' })
    expect(selectedClass(options()[0])).toBe(true)
    fireEvent.keyDown(input, { key: 'ArrowUp', code: 'ArrowUp' })
    expect(selectedClass(options()[2])).toBe(true)
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(3)
    expect(scrollIntoViewSpy).toHaveBeenLastCalledWith({ block: 'nearest' })

    // Every call targeted the currently selected option element.
    for (const call of scrollIntoViewSpy.mock.calls) {
      expect(call).toEqual([{ block: 'nearest' }])
    }
  })

  it('injects the selected user on Enter instead of submitting, then closes the list', async () => {
    const input = await openAutoComplete()

    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledWith(expect.stringContaining('@bob')))
    expect(sendSpy).not.toHaveBeenCalledWith(submitShape())
    await vi.waitFor(() => expect(options()).toHaveLength(0))
  })

  it('closes the list on Escape without submitting or scrolling', async () => {
    const input = await openAutoComplete()

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' })

    await vi.waitFor(() => expect(options()).toHaveLength(0))
    expect(sendSpy).not.toHaveBeenCalledWith(submitShape())
    expect(scrollIntoViewSpy).not.toHaveBeenCalled()
  })
})

describe('Footer step-4 submit gate', () => {
  it('disables the send button and no-ops Enter while CanSubmitTextQuery is false, keeping the draft', () => {
    renderFooter()

    expect((sendButton() as HTMLButtonElement).disabled).toBe(true)

    // Editing stays available: typing dispatches InputCommand (draft recorded) but submission is a no-op.
    fireEvent.input(textarea(), { target: { value: 'draft' } })
    expect(sendSpy).toHaveBeenCalledWith('draft')

    pressEnter()
    expect(sendSpy).not.toHaveBeenCalledWith(submitShape())
    fireEvent.click(sendButton())
    expect(sendSpy).not.toHaveBeenCalledWith(submitShape())
  })

  it('enables the button and lets Enter submit exactly once when CanSubmitTextQuery becomes true', async () => {
    canSubmitText = true
    renderFooter()

    expect((sendButton() as HTMLButtonElement).disabled).toBe(false)

    pressEnter()
    await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1))
    expect(sendSpy).toHaveBeenCalledWith(submitShape())
  })

  it('lets Shift+Enter edit without submitting or preventing default editing behavior', () => {
    canSubmitText = true
    renderFooter()

    // dispatchEvent returns true when default was NOT prevented: Shift+Enter keeps editing.
    const notPrevented = fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter', shiftKey: true })
    expect(notPrevented).toBe(true)
    expect(sendSpy).not.toHaveBeenCalledWith(submitShape())

    // Editing stays fully available after the Shift+Enter keypress.
    fireEvent.input(textarea(), { target: { value: 'edited draft' } })
    expect(sendSpy).toHaveBeenCalledWith('edited draft')
    expect(sendSpy).not.toHaveBeenCalledWith(submitShape())
  })

  it('does not let a gated Enter occupy the real throttle window: after recovery the first Enter submits', async () => {
    const { rerender } = render(<Footer />)

    // Before connection: Enter is gated before the throttled submit path.
    pressEnter()
    await Promise.resolve()
    expect(sendSpy).not.toHaveBeenCalledWith(submitShape())

    // Connection completes: the very next Enter must not be swallowed by a stale throttle window.
    canSubmitText = true
    rerender(<Footer />)
    expect((sendButton() as HTMLButtonElement).disabled).toBe(false)

    pressEnter()
    await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1))
    expect(sendSpy).toHaveBeenCalledWith(submitShape())
  })
})
