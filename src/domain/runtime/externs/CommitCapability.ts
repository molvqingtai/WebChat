import { Remesh } from 'remesh'

/**
 * A synchronous Server-to-Connection permit. It is never serialized, exposed to a Page, or
 * derived from a current binding map after the operation has begun.
 */
export interface CommitCapability {
  consume: (capabilityId: string) => boolean
  revoke: (capabilityId: string) => void
}

export const CommitCapabilityExtern = Remesh.extern<CommitCapability>({
  default: {
    consume: () => false,
    revoke: () => {}
  }
})
