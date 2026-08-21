import { Remesh } from 'remesh'

/**
 * Private in-memory commit capability (K). Minted by the Server execution envelope for one exact
 * `{binding, operationId}` pair, consumed synchronously at the first irreversible effect boundary
 * (initial join dispatch / reconnect reset), and afterwards authorizing only that exact
 * operation's final commit. A live unconsumed capability can be revoked by its binding's exact
 * invalidation; a consumed capability is authoritative and can never be revoked or re-minted.
 *
 * Tokens are opaque object identities: they never cross the Page RPC boundary, never enter peer
 * protocol, storage, or any durable structure.
 */
export interface CommitCapability {
  readonly brand: 'CommitCapability'
}

export interface CommitCapabilityMeta {
  readonly operationId: string
  readonly domain: string
  readonly kind: 'join' | 'reconnect'
  /** Exact binding object identity the capability was minted for. */
  readonly binding: unknown
}

export interface CommitAuthority {
  mint: (meta: CommitCapabilityMeta) => CommitCapability
  /**
   * One-shot synchronous consume at the first irreversible boundary. Returns false when the token
   * was revoked or already consumed; a false result must abort the operation before any effect.
   */
  consume: (token: CommitCapability) => boolean
  /** True only for a consumed token: authorizes that exact operation's later commit. */
  authorizes: (token: CommitCapability) => boolean
  /** Revokes every live unconsumed token minted for the exact binding object. */
  revokeBinding: (binding: unknown) => void
}

export const createCommitAuthority = (): CommitAuthority => {
  interface Entry {
    state: 'live' | 'consumed' | 'revoked'
    meta: CommitCapabilityMeta
  }
  const entries = new WeakMap<CommitCapability, Entry>()
  const byBinding = new WeakMap<object, Set<CommitCapability>>()
  return {
    mint: (meta) => {
      const token: CommitCapability = { brand: 'CommitCapability' }
      entries.set(token, { state: 'live', meta })
      if (typeof meta.binding === 'object' && meta.binding !== null) {
        let tokens = byBinding.get(meta.binding)
        if (!tokens) {
          tokens = new Set()
          byBinding.set(meta.binding, tokens)
        }
        tokens.add(token)
      }
      return token
    },
    consume: (token) => {
      const entry = entries.get(token)
      if (!entry || entry.state !== 'live') return false
      entry.state = 'consumed'
      return true
    },
    authorizes: (token) => entries.get(token)?.state === 'consumed',
    revokeBinding: (binding) => {
      if (typeof binding !== 'object' || binding === null) return
      for (const token of byBinding.get(binding) ?? []) {
        const entry = entries.get(token)
        if (entry?.state === 'live') entry.state = 'revoked'
      }
    }
  }
}

export const CommitCapabilityExtern = Remesh.extern<CommitAuthority>({
  default: createCommitAuthority()
})
