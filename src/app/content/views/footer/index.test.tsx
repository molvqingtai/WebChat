import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
