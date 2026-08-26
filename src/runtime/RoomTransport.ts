import type { ChatSite, ChatUser, SessionMessage, WorldRoomMessage } from '@/protocol'

/** Internal Offscreen/Runtime handoff terminal; never exposed to Page or peer wire. */
export type RoomMessageTerminal = 'committed' | 'invalid'

declare const recoveryBindingCapability: unique symbol

/** Process-local identity only. Its physical binding is intentionally not inspectable. */
export interface RecoveryBindingCapability {
  readonly [recoveryBindingCapability]: never
}

/** A capability is valid only for the exact physical room that minted it. */
export interface RecoveryBindingCapabilityUse {
  roomId: string
  capability: RecoveryBindingCapability
}

/** Current World facts captured by the surviving physical transport for a fresh logical Runtime. */
export interface WorldTransportRecovery {
  members: Array<{ sourcePeerId: string; sourceGeneration: number }>
  presences: Array<{ sourcePeerId: string; sourceGeneration: number; presence: WorldRoomMessage }>
  /** A World owner commit, tied to the current physical World peer. */
  local?: {
    peerId: string
    /** Offscreen's current physical room incarnation; never supplied by the logical Runtime. */
    handle: string
    registrations: Array<{ domain: string; user: ChatUser; site: ChatSite }>
  }
}

/** Current Room facts captured by the surviving physical transport for a fresh logical Runtime. */
export interface RoomTransportRecovery {
  rooms: Array<{
    roomId: string
    domain: string
    local: {
      sessionId: string
      presenceId: string
      user: ChatUser
      site: ChatSite
      joinedAt: number
    }
    sessions: Array<{ sourcePeerId: string; sourceGeneration: number; session: SessionMessage }>
  }>
}

/** The committed local Room identity is recorded separately from wire-derived remote sessions. */
export interface RoomLocalTransportRecovery {
  roomId: string
  domain: string
  local: RoomTransportRecovery['rooms'][number]['local']
}

/** A state owner confirms this current fact after domain validation and commit. */
export interface WorldTransportRecoveryFact {
  members: WorldTransportRecovery['members']
  presences: WorldTransportRecovery['presences']
  local?: Omit<NonNullable<WorldTransportRecovery['local']>, 'handle'>
}

/** Trusted source metadata is supplied by the physical room/peer. */
export interface RoomTransport {
  /** The current physical peer identity of the exact room's owner, or '' when the room has none. */
  readonly peerIdOf: (roomId: string) => string
  /** Resolves only after the provider has created the physical room. */
  join: (roomId: string) => Promise<void>
  leave: (roomId: string, options?: { diagnosticOnly?: boolean }) => void
  /**
   * Passes the selected targets to the provider directly; an omitted target means the provider's
   * own room broadcast, and an empty target list sends nothing. The provider's send settlement or
   * rejection is surfaced as-is. Missing/stale/untrusted rooms and pre-target codec/validation
   * failures reject the operation.
   */
  send: (roomId: string, payload: string, to?: string | string[]) => Promise<void>
  onMessage: (callback: (roomId: string, sourcePeerId: string, rawPayload: string) => unknown) => () => void
  onPeerJoin: (callback: (roomId: string, peerId: string) => void) => () => void
  onPeerLeave: (callback: (roomId: string, peerId: string) => void) => () => void
  onRoomClose: (callback: (roomId: string) => void) => () => void
  /** Provider errors always carry their exact room scope; retired owners never emit. */
  onError: (callback: (error: Error, roomId: string) => void) => () => void
  /** Available only for a fresh Background reconnected to a surviving Offscreen transport. */
  worldRecovery?: () => WorldTransportRecovery
  /** Available only for a fresh Background reconnected to a surviving Offscreen transport. */
  roomRecovery?: () => RoomTransportRecovery
  /** Mints an opaque owner-hydration capability for one current physical room. */
  mintRecoveryBindingCapability?: (roomId: string) => RecoveryBindingCapability | null
  /** Verifies every capability first, then consumes all of them atomically. */
  consumeRecoveryBindingCapabilities?: (capabilities: readonly RecoveryBindingCapabilityUse[]) => boolean
  /** Marks a Room as requiring a complete recovery snapshot on a future logical replacement. */
  requireRoomRecovery?: (roomId: string, domain: string) => Promise<void>
  /** Records owner-confirmed World state for future logical Runtime recovery. */
  rememberWorldRecovery?: (recovery: WorldTransportRecoveryFact) => Promise<void>
  /** Records one committed Room aggregate for future logical Runtime recovery. */
  rememberRoomRecovery?: (recovery: RoomTransportRecovery['rooms'][number]) => Promise<void>
  /** Opens a rebind's ordered ingress only after recovery state is installed in its owners. */
  activateIngress?: () => void | Promise<void>
  /**
   * Server-private replacement primitive. It resolves only after every selected exact owner has
   * stopped local routing and its applicable provider leave/close has settled. It is never a
   * Page or peer protocol terminal.
   */
  retireRoomsForPreparation: (roomIds: readonly string[]) => Promise<void>
  dispose: () => void
}
