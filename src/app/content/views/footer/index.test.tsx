import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Footer from './index'

vi.mock('remesh-react', () => ({
  useRemeshSend: () => sendSpy,
  useRemeshDomain: () => fakeDomain,
  useRemeshQuery: (query: { name: string }) =>
    query.name === 'Room.CanSubmitTextQuery' ? canSubmitText : (queryFixtures[query.name] ?? null)
}))

vi.mock('@/hooks/useThrottle', () => ({ default: (fn: () => void) => fn }))
vi.mock('@/hooks/useRoot', () => ({ default: () => null }))
vi.mock('@/hooks/useCursorPosition', () => ({
  default: () => ({ x: 0, y: 0, selectionStart: 0, selectionEnd: 0, setRef: () => {} })
}))
vi.mock('imgcap', () => ({ default: vi.fn() }))

const sendSpy = vi.fn((_action: unknown) => {})
const command = (kind: string) => (value: unknown) => ({ kind, value }) as const
const fakeDomain = {
  query: {
    MessageQuery: () => ({ name: 'MessageInput.ValueQuery' }),
    UserInfoQuery: () => ({ name: 'UserInfo.UserInfoQuery' }),
    UserListQuery: () => ({ name: 'Room.UserListQuery' }),
    CanSubmitTextQuery: () => ({ name: 'Room.CanSubmitTextQuery' })
  },
  command: {
    InputCommand: command('MessageInput.InputCommand'),
    ClearCommand: command('MessageInput.ClearCommand'),
    WarningCommand: command('Toast.WarningCommand'),
    SendTextMessageCommand: command('Room.SendTextMessageCommand')
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

const pressEnter = () => {
  fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter', shiftKey: false })
}

describe('Footer step-4 submit gate', () => {
  it('disables the send button and no-ops Enter while CanSubmitTextQuery is false, keeping the draft', () => {
    renderFooter()

    expect((sendButton() as HTMLButtonElement).disabled).toBe(true)

    // Editing stays available: typing dispatches InputCommand (draft recorded) but submission is a no-op.
    fireEvent.input(textarea(), { target: { value: 'draft' } })
    expect(sendSpy).toHaveBeenCalledWith({ kind: 'MessageInput.InputCommand', value: 'draft' })

    pressEnter()
    expect(sendSpy).not.toHaveBeenCalledWith({ kind: 'Room.SendTextMessageCommand', value: expect.anything() })
    fireEvent.click(sendButton())
    expect(sendSpy).not.toHaveBeenCalledWith({ kind: 'Room.SendTextMessageCommand', value: expect.anything() })
  })

  it('enables the button and lets Enter submit exactly once when CanSubmitTextQuery becomes true', async () => {
    canSubmitText = true
    renderFooter()

    expect((sendButton() as HTMLButtonElement).disabled).toBe(false)

    pressEnter()
    await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1))
    expect(sendSpy).toHaveBeenCalledWith({
      kind: 'Room.SendTextMessageCommand',
      value: { body: 'hello', mentions: [] }
    })
  })
})
