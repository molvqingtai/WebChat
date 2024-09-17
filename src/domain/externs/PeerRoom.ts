import { Remesh } from 'remesh'
import { type Promisable } from 'type-fest'

export type PeerMessage = object | Blob | ArrayBuffer | ArrayBufferView

export interface PeerRoom {
  readonly selfId: string
  joinRoom: (roomId: string) => Promise<any>
  sendMessage: <T extends PeerMessage>(message: T) => Promise<any>
  onMessage: <T extends PeerMessage>(callback: (message: T) => void) => Promisable<void>
  leaveRoom: () => Promisable<void>
  onJoinRoom: (callback: (id: string) => void) => Promisable<void>
  onLeaveRoom: (callback: (id: string) => void) => Promisable<void>
  getRoomPeers: () => string[]
}

export const PeerRoomExtern = Remesh.extern<PeerRoom>({
  default: {
    selfId: '',
    joinRoom: async () => {
      throw new Error('"joinRoom" not implemented.')
    },
    sendMessage: async () => {
      throw new Error('"sendMessage" not implemented.')
    },
    onMessage: () => {
      throw new Error('"onMessage" not implemented.')
    },
    leaveRoom: () => {
      throw new Error('"leaveRoom" not implemented.')
    },
    onJoinRoom: () => {
      throw new Error('"onJoinRoom" not implemented.')
    },
    onLeaveRoom: () => {
      throw new Error('"onLeaveRoom" not implemented.')
    },
    getRoomPeers: () => {
      throw new Error('"getRoomPeers" not implemented.')
    }
  }
})
