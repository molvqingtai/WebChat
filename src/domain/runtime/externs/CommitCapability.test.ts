import { describe, expect, it } from 'vitest'
import { createCommitCapability } from './CommitCapability'

describe('CommitCapability', () => {
  it('permits exactly one consume and ignores a later revocation', () => {
    const capability = createCommitCapability('operation-a')

    expect(capability.consume()).toBe(true)
    capability.revoke()

    expect(capability.allows()).toBe(true)
    expect(capability.consume()).toBe(false)
  })

  it('blocks a revoked capability before any irreversible admission', () => {
    const capability = createCommitCapability('operation-b')

    capability.revoke()

    expect(capability.consume()).toBe(false)
    expect(capability.allows()).toBe(false)
  })
})
