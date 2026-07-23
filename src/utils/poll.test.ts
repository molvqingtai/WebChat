import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import poll from '@/utils/poll'

describe('poll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately on first success', async () => {
    const attempt = vi.fn().mockResolvedValue('ready')
    await expect(poll(attempt, { timeoutMs: 1000, intervalMs: 100 })).resolves.toBe('ready')
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('retries past transient failures until success (cold start > 1s)', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error('heartbeat check timeout 1000ms'))
      .mockRejectedValueOnce(new Error('heartbeat check timeout 1000ms'))
      .mockResolvedValue('ready')

    const result = poll(attempt, { timeoutMs: 15000, intervalMs: 500 })
    await vi.advanceTimersByTimeAsync(1100)
    await expect(result).resolves.toBe('ready')
    expect(attempt).toHaveBeenCalledTimes(3)
  })

  it('rethrows the last error when the timeout is exhausted', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('still down'))
    const result = poll(attempt, { timeoutMs: 1000, intervalMs: 400 })
    const assertion = expect(result).rejects.toThrow('still down')
    await vi.advanceTimersByTimeAsync(2000)
    await assertion
    // 0ms, 400ms, 800ms attempts; the 1200ms attempt would pass the deadline.
    expect(attempt).toHaveBeenCalledTimes(3)
  })
})
