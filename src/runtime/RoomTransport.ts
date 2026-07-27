/** Trusted source metadata is supplied by the physical Artico room/call. */
export interface RoomTransport {
  readonly peerId: string
  /** Resolves only after the provider has created the physical room. */
  join: (roomId: string) => Promise<void>
  leave: (roomId: string) => void
  /**
   * Resolves after all selected target attempts, including an empty set; target-local provider
   * rejections are contained. Missing/stale/untrusted rooms and pre-target codec/validation failures
   * reject the operation.
   */
  send: (roomId: string, payload: string, to?: string | string[]) => Promise<void>
  onMessage: (callback: (roomId: string, sourcePeerId: string, rawPayload: string) => void) => () => void
  onPeerJoin: (callback: (roomId: string, peerId: string) => void) => () => void
  onPeerLeave: (callback: (roomId: string, peerId: string) => void) => () => void
  onRoomClose: (callback: (roomId: string) => void) => () => void
  onError: (callback: (error: Error) => void) => () => void
  dispose: () => void
}
