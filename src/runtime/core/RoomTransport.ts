/** The only network capability the Runtime core sees. Hosts inject an implementation. */
export interface RoomTransport {
  /** Local peer id in that room, or '' when the room is not joined. */
  peerIdOf: (roomId: string) => string
  /** Resolves once the provider room exists. */
  join: (roomId: string) => Promise<void>
  /** Resolves once the provider has torn the room down; callers reconnect only after it settles. */
  leave: (roomId: string) => Promise<void>
  /** No `to` broadcasts to the room. The core never passes an empty target list. */
  send: (roomId: string, payload: string, to?: string | string[]) => Promise<void>
  onMessage: (callback: (roomId: string, sourcePeerId: string, payload: string) => void) => () => void
  onPeerJoin: (callback: (roomId: string, peerId: string) => void) => () => void
  onPeerLeave: (callback: (roomId: string, peerId: string) => void) => () => void
  onRoomClose: (callback: (roomId: string) => void) => () => void
  onError: (callback: (error: Error, roomId: string) => void) => () => void
  dispose: () => void
}
