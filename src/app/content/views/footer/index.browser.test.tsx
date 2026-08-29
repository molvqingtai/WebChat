import { cleanup, render } from 'vitest-browser-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@/assets/styles/tailwind.css'
import Footer from './index'

vi.mock('remesh-react', () => ({
  useRemeshSend: () => sendSpy,
  useRemeshDomain: () => fakeDomain,
  useRemeshQuery: (query: { name: string }) =>
    query.name === 'Room.CanSubmitTextQuery' ? false : (queryFixtures[query.name] ?? null)
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
const queryFixtures: Record<string, unknown> = {
  'MessageInput.ValueQuery': '@',
  'UserInfo.UserInfoQuery': { id: 'local-user', name: 'Local', avatar: '' },
  'Room.UserListQuery': []
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  queryFixtures['Room.UserListQuery'] = []
})

const options = () => [...document.querySelectorAll<HTMLElement>('[data-index]')]
const autoCompleteViewport = () =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="scroll-area-viewport"]')].find((element) =>
    element.querySelector('[data-index]')
  )!

describe('Footer @ autocomplete list geometry', () => {
  it('keeps a long option list as real DOM with 28px intrinsic rows and native active-option visibility', async () => {
    queryFixtures['Room.UserListQuery'] = Array.from({ length: 100 }, (_, index) => ({
      id: `user-${index}`,
      name: `user-${index}`,
      avatar: ''
    }))

    await render(<Footer />)
    const input = document.querySelector<HTMLTextAreaElement>('textarea')!
    input.value = '@'
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '@' }))

    await vi.waitFor(() => expect(options()).toHaveLength(100))

    // Row-level optimization contract on each option's own surface. 16px content-box fallback +
    // 12px padding yields the existing 28px option-row outer geometry (probe-verified:
    // skipped outer = fallback + padding at 0/16/28/40px; 16px gives 28px rows, 2800 at N=100).
    const firstOption = options()[0]
    expect(getComputedStyle(firstOption).contentVisibility).toBe('auto')
    expect(getComputedStyle(firstOption).containIntrinsicSize).toContain('16px')

    // Real-geometry bound: 100 option rows (28px outer each) inside the max-h-[204px] viewport.
    const listViewport = autoCompleteViewport()
    expect(listViewport.scrollHeight).toBeGreaterThan(100 * 27)
    expect(listViewport.scrollHeight).toBeLessThan(100 * 29)
    expect(listViewport.scrollHeight).toBeGreaterThan(listViewport.clientHeight)

    // Native selected-item visibility: keyboard navigation scrolls the active option into view.
    // Dispatch sequentially like real key repeat: each event waits for its own selection commit,
    // because the production handler reads the selected index from its render closure.
    for (let step = 0; step < 30; step += 1) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      await vi.waitFor(() => expect(options()[step + 1].className).toContain('bg-accent'))
    }
    const optionBounds = options()[30].getBoundingClientRect()
    const viewportBounds = listViewport.getBoundingClientRect()
    expect(optionBounds.top).toBeGreaterThanOrEqual(viewportBounds.top - 1)
    expect(optionBounds.bottom).toBeLessThanOrEqual(viewportBounds.bottom + 1)
  })
})
