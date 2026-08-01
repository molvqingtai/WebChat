import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectedTextMessage } from '@/domain/MessageList'
import MessageItem from './message-item'

vi.mock('@number-flow/react', () => ({ default: ({ value }: { value: number }) => <span>{value}</span> }))

const currentUser = { id: 'current', name: 'Current', avatar: '' }
const otherUser = { id: 'other', name: 'Other', avatar: '' }

const message = (
  likes: ProjectedTextMessage['reactions']['likes'] = [],
  hates: ProjectedTextMessage['reactions']['hates'] = []
): ProjectedTextMessage => ({
  type: 'text',
  id: 'message',
  hlc: { timestamp: 1, counter: 0 },
  receivedAt: 1,
  userId: otherUser.id,
  author: otherUser,
  body: 'Hello',
  mentions: [],
  reactions: { likes, hates }
})

const actions = () => {
  const [like, hate] = screen.getAllByRole('button')
  return { like, hate }
}

afterEach(cleanup)

describe('message reaction presentation', () => {
  it("shows another user's positive like aggregate in the existing active color while keeping add-like truth", () => {
    const onLikeChange = vi.fn()
    render(<MessageItem data={message([otherUser])} like={false} hate={false} onLikeChange={onLikeChange} />)

    const { like } = actions()
    expect(like.classList.contains('text-orange-500')).toBe(true)
    expect(like.getAttribute('aria-pressed')).toBe('false')
    expect(like.textContent).toContain('1')

    fireEvent.click(like)
    expect(onLikeChange).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('keeps the aggregate active after self removal while another like remains', () => {
    const onLikeChange = vi.fn()
    const view = render(
      <MessageItem data={message([currentUser, otherUser])} like hate={false} onLikeChange={onLikeChange} />
    )

    fireEvent.click(actions().like)
    expect(onLikeChange).toHaveBeenCalledExactlyOnceWith(false)

    view.rerender(<MessageItem data={message([otherUser])} like={false} hate={false} />)
    expect(actions().like.classList.contains('text-orange-500')).toBe(true)
    expect(actions().like.textContent).toContain('1')
  })

  it('returns the final zero-like aggregate to gray without rendering a zero count', () => {
    const view = render(<MessageItem data={message([currentUser])} like hate={false} />)
    expect(actions().like.classList.contains('text-orange-500')).toBe(true)

    view.rerender(<MessageItem data={message()} like={false} hate={false} />)
    expect(actions().like.classList.contains('text-slate-500')).toBe(true)
    expect(actions().like.textContent).not.toContain('0')
  })

  it('keeps hate color and toggle state independent from positive aggregate counts', () => {
    const view = render(<MessageItem data={message([otherUser], [otherUser])} like={false} hate={false} />)
    expect(actions().like.classList.contains('text-orange-500')).toBe(true)
    expect(actions().hate.classList.contains('text-slate-500')).toBe(true)
    expect(actions().hate.getAttribute('aria-pressed')).toBe('false')

    view.rerender(<MessageItem data={message([], [currentUser, otherUser])} like={false} hate />)
    expect(actions().like.classList.contains('text-slate-500')).toBe(true)
    expect(actions().hate.classList.contains('text-orange-500')).toBe(true)
    expect(actions().hate.getAttribute('aria-pressed')).toBe('true')
  })
})
