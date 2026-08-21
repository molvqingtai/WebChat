/** Trusted source metadata is supplied by the physical room/peer. */
export interface RoomTransport {
  /** The current physical peer identity of the exact room's owner, or '' when the room has none. */
  readonly peerIdOf: (roomId: string) => string
  /** Resolves only after the provider has created the physical room. */
  join: (roomId: string, options?: { joinId?: string }) => Promise<void>
  /** Resolves only after this exact pending provider join can no longer create or use its room. */
  abortJoin?: (roomId: string, joinId: string) => Promise<void>
  leave: (roomId: string, options?: { diagnosticOnly?: boolean }) => void
  /**
   * Passes the selected targets to the provider directly; an omitted target means the provider's
   * own room broadcast, and an empty target list sends nothing. The provider's send settlement or
   * rejection is surfaced as-is. Missing/stale/untrusted rooms and pre-target codec/validation
   * failures reject the operation.
   */
  send: (roomId: string, payload: string, to?: string | string[]) => Promise<void>
  onMessage: (callback: (roomId: string, sourcePeerId: string, rawPayload: string) => void) => () => void
  onPeerJoin: (callback: (roomId: string, peerId: string) => void) => () => void
  onPeerLeave: (callback: (roomId: string, peerId: string) => void) => () => void
  onRoomClose: (callback: (roomId: string) => void) => () => void
  /** Provider errors always carry their exact room scope; retired owners never emit. */
  onError: (callback: (error: Error, roomId: string) => void) => () => void
  dispose: () => void
}
