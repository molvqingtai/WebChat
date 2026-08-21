import { Remesh } from 'remesh'

/**
 * An in-memory, operation-scoped admission token.  It deliberately has no
 * serializable shape: its only job is to make the same Server decision visible
 * at the later Connection commit boundary.
 */
export interface CommitCapability {
  readonly operationId: string
  consume: () => boolean
  revoke: () => void
  allows: () => boolean
}

export const createCommitCapability = (operationId: string): CommitCapability => {
  let state: 'live' | 'consumed' | 'revoked' = 'live'
  return {
    operationId,
    consume: () => {
      if (state !== 'live') return false
      state = 'consumed'
      return true
    },
    revoke: () => {
      if (state === 'live') state = 'revoked'
    },
    allows: () => state === 'consumed'
  }
}

export interface CommitCapabilityRegistry {
  get: (operationId: string) => CommitCapability | undefined
}

export const CommitCapabilityExtern = Remesh.extern<CommitCapabilityRegistry>({
  default: {
    get: () => undefined
  }
})
