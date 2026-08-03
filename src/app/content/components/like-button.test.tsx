import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectedTextMessage } from '@/domain/MessageList'
import LikeButton from './like-button'
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
  it('derives presentation only from count while checked remains toggle truth', () => {
    const view = render(
      <LikeButton checked={false} count={1}>
        <span>Like</span>
      </LikeButton>
    )
    const button = screen.getByRole('button')
    expect(button.classList.contains('text-orange-500')).toBe(true)
    expect(button.getAttribute('aria-pressed')).toBe('false')

    view.rerender(
      <LikeButton checked count={0}>
        <span>Like</span>
      </LikeButton>
    )
    expect(button.classList.contains('text-slate-500')).toBe(true)
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it("shows another user's positive like aggregate while emitting one like toggle intent", () => {
    const onToggleLike = vi.fn()
    render(<MessageItem data={message([otherUser])} like={false} hate={false} onToggleLike={onToggleLike} />)

    const { like } = actions()
    expect(like.classList.contains('text-orange-500')).toBe(true)
    expect(like.getAttribute('aria-pressed')).toBe('false')
    expect(like.textContent).toContain('1')

    fireEvent.click(like)
    expect(onToggleLike).toHaveBeenCalledExactlyOnceWith()
  })

  it('keeps the aggregate active after canonical self removal while another like remains', () => {
    const onToggleLike = vi.fn()
    const view = render(
      <MessageItem data={message([currentUser, otherUser])} like hate={false} onToggleLike={onToggleLike} />
    )

    fireEvent.click(actions().like)
    expect(onToggleLike).toHaveBeenCalledExactlyOnceWith()

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

  it("shows another user's hate aggregate while emitting one hate toggle intent", () => {
    const onToggleHate = vi.fn()
    render(<MessageItem data={message([], [otherUser])} like={false} hate={false} onToggleHate={onToggleHate} />)

    const { hate } = actions()
    expect(hate.classList.contains('text-orange-500')).toBe(true)
    expect(hate.getAttribute('aria-pressed')).toBe('false')
    expect(hate.textContent).toContain('1')

    fireEvent.click(hate)
    expect(onToggleHate).toHaveBeenCalledExactlyOnceWith()
  })

  it('keeps the hate aggregate active after canonical self removal while another hate remains', () => {
    const onToggleHate = vi.fn()
    const view = render(
      <MessageItem data={message([], [currentUser, otherUser])} like={false} hate onToggleHate={onToggleHate} />
    )

    fireEvent.click(actions().hate)
    expect(onToggleHate).toHaveBeenCalledExactlyOnceWith()

    view.rerender(<MessageItem data={message([], [otherUser])} like={false} hate={false} />)
    expect(actions().hate.classList.contains('text-orange-500')).toBe(true)
    expect(actions().hate.textContent).toContain('1')
  })

  it('returns the final zero-hate aggregate to gray without rendering a zero count', () => {
    const view = render(<MessageItem data={message([], [currentUser])} like={false} hate />)
    expect(actions().hate.classList.contains('text-orange-500')).toBe(true)

    view.rerender(<MessageItem data={message()} like={false} hate={false} />)
    expect(actions().hate.classList.contains('text-slate-500')).toBe(true)
    expect(actions().hate.textContent).not.toContain('0')
  })

  it('keeps like and hate aggregate colors independent', () => {
    const view = render(<MessageItem data={message([otherUser])} like={false} hate={false} />)
    expect(actions().like.classList.contains('text-orange-500')).toBe(true)
    expect(actions().hate.classList.contains('text-slate-500')).toBe(true)

    view.rerender(<MessageItem data={message([], [otherUser])} like={false} hate={false} />)
    expect(actions().like.classList.contains('text-slate-500')).toBe(true)
    expect(actions().hate.classList.contains('text-orange-500')).toBe(true)
  })
})
