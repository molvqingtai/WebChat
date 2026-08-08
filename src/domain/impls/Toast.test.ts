import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastImpl } from '@/domain/impls/Toast'

const sonner = vi.hoisted(() => ({
  success: vi.fn(() => 'success'),
  error: vi.fn(() => 'error'),
  info: vi.fn(() => 'info'),
  warning: vi.fn(() => 'warning'),
  loading: vi.fn(() => 'loading'),
  dismiss: vi.fn(() => 'dismissed')
}))

vi.mock('sonner', () => ({ toast: sonner }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => vi.useRealTimers())

describe('ToastImpl loading lifecycle', () => {
  it('keeps an unbounded loading toast active until its owner cancels it', () => {
    expect(ToastImpl.value.loading('Reconnecting to the chat...')).toBe('loading')

    expect(sonner.loading).toHaveBeenCalledWith('Reconnecting to the chat...', { duration: undefined })
    expect(vi.getTimerCount()).toBe(0)
    expect(sonner.dismiss).not.toHaveBeenCalled()
  })

  it('retains timed loading behavior when a duration is provided', () => {
    expect(ToastImpl.value.loading('Connected to the chat...', 3000)).toBe('loading')

    expect(sonner.loading).toHaveBeenCalledWith('Connected to the chat...', { duration: 3000 })
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(3000)
    expect(sonner.dismiss).toHaveBeenCalledWith('loading')
  })
})
