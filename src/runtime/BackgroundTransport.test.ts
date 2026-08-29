import { describe, expect, it, vi } from 'vitest'
import { selectBackgroundTransport } from '@/runtime/BackgroundTransport'
import type { RoomTransport } from '@/runtime/RoomTransport'

describe('Background transport selection', () => {
  it('keeps Firefox on its direct transport and requests Offscreen only for Chromium', async () => {
    const remote = {} as RoomTransport
    const ensureChromiumTransport = vi.fn(async () => remote)

    await expect(selectBackgroundTransport(true, ensureChromiumTransport)).resolves.toBeUndefined()
    expect(ensureChromiumTransport).not.toHaveBeenCalled()
    await expect(selectBackgroundTransport(false, ensureChromiumTransport)).resolves.toBe(remote)
    expect(ensureChromiumTransport).toHaveBeenCalledOnce()
  })
})
