/** Trusted source metadata is supplied by the physical Artico room/call. */
export interface RoomTransport {
  /**
   * @deprecated Host-wide identity no longer exists; each joined room owns its scoped peer. Use
   * {@link RoomTransport.peerIdOf}. Always empty.
   */
  readonly peerId: string
  /** The current physical peer identity of the exact room's owner, or '' when the room has none. */
  readonly peerIdOf: (roomId: string) => string
  /** Resolves only after the provider has created the physical room. */
  join: (roomId: string) => Promise<void>
  leave: (roomId: string) => void
  /**
   * Current physical members of a joined room, regardless of call readiness.
   */
  peers: (roomId: string) => string[]
  /**
   * Attempts each selected target exactly once, including an empty set; a target-local provider
   * throw does not prevent later targets and the first genuine throw rejects after all attempts.
   * Missing/stale/untrusted rooms and pre-target codec/validation failures reject the operation.
   */
  send: (roomId: string, payload: string, to?: string | string[]) => Promise<void>
  onMessage: (callback: (roomId: string, sourcePeerId: string, rawPayload: string) => void) => () => void
  onPeerJoin: (callback: (roomId: string, peerId: string) => void) => () => void
  onPeerLeave: (callback: (roomId: string, peerId: string) => void) => () => void
  onRoomClose: (callback: (roomId: string) => void) => () => void
  onError: (callback: (error: Error) => void) => () => void
  dispose: () => void
}
