import { Remesh } from 'remesh'
import { RoomMessage } from '../Room'

export interface PeerRoom {
  readonly peerId: string
  readonly roomId: string
  joinRoom: () => PeerRoom
  sendMessage: (message: RoomMessage, id?: string | string[]) => PeerRoom
  onMessage: (callback: (message: RoomMessage) => void) => PeerRoom
  leaveRoom: () => PeerRoom
  onJoinRoom: (callback: (id: string) => void) => PeerRoom
  onLeaveRoom: (callback: (id: string) => void) => PeerRoom
  onError: (callback: (error: Error) => void) => PeerRoom
}

export const PeerRoomExtern = Remesh.extern<PeerRoom>({
  default: {
    peerId: '',
    roomId: '',
    joinRoom: () => {
      throw new Error('"joinRoom" not implemented.')
    },
    sendMessage: () => {
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
    onError: () => {
      throw new Error('"onError" not implemented.')
    }
  }
})
