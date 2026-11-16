import { describe, expect, it } from 'vitest'
import { DELIVERY_FAILURE_MESSAGE } from '@/constants/config'
import { shouldReportRoomError } from './shouldReportRoomError'

describe('room error reporting', () => {
  it('stays quiet about a message that never left the sender', () => {
    expect(shouldReportRoomError(DELIVERY_FAILURE_MESSAGE)).toBe(false)
  })

  it('keeps reporting the failures a user can act on', () => {
    expect(shouldReportRoomError('Room join timeout')).toBe(true)
    expect(shouldReportRoomError('Trystero: signaling server refused the connection')).toBe(true)
  })
})
