import { describe, expect, it } from 'vitest'
import { createConnectionLifecycle } from '@/domain/impls/ConnectionLifecycle'

describe('ConnectionLifecycle per-attempt token isolation', () => {
  it('keeps each attempt result owned by its own exact token across overlapping operations', () => {
    const { value, tokenAcquirer } = createConnectionLifecycle()

    // Two overlapping connection invocations each reserve and own a distinct token.
    const tokenA = value.beginAttempt()
    const tokenB = value.beginAttempt()

    // The adapter reports outcomes for each attempt by its own acquired token.
    tokenAcquirer.acquire() // consumes a reserved token for attempt A
    tokenAcquirer.report(tokenA, 'cancelled')
    tokenAcquirer.acquire() // B
    tokenAcquirer.report(tokenB, 'failed')

    // A superseded/cancelled attempt must not corrupt its successor's real failure and vice-versa.
    expect(value.getAttemptResult(tokenA)).toBe('cancelled')
    expect(value.getAttemptResult(tokenB)).toBe('failed')
  })

  it('reports a per-token result that the owning invocation alone can read', () => {
    const { value, tokenAcquirer } = createConnectionLifecycle()
    const token = value.beginAttempt()
    tokenAcquirer.report(token, 'cancelled')
    expect(value.getAttemptResult(token)).toBe('cancelled')
  })
})
