import { Remesh } from 'remesh'
import { type Promisable } from 'type-fest'

export type PeerMessage = object | Blob | ArrayBuffer | ArrayBufferView

export interface PeerRoom {
  joinRoom: (roomId: string) => Promise<any>
  sendMessage: <T extends PeerMessage>(message: T) => Promise<any>
  onMessage: <T extends PeerMessage>(callback: (message: T) => void) => Promisable<void>
  leaveRoom: () => Promisable<void>
}

export const PeerRoomExtern = Remesh.extern<PeerRoom>({
  default: {
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
    }
  }
})
