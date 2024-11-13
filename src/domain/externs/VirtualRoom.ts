import { Remesh } from 'remesh'
import { RoomMessage } from '@/domain/VirtualRoom'

export interface VirtualRoom {
  readonly peerId: string
  readonly roomId: string
  joinRoom: () => VirtualRoom
  sendMessage: (message: RoomMessage, id?: string | string[]) => VirtualRoom
  onMessage: (callback: (message: RoomMessage) => void) => VirtualRoom
  leaveRoom: () => VirtualRoom
  onJoinRoom: (callback: (id: string) => void) => VirtualRoom
  onLeaveRoom: (callback: (id: string) => void) => VirtualRoom
  onError: (callback: (error: Error) => void) => VirtualRoom
}

export const VirtualRoomExtern = Remesh.extern<VirtualRoom>({
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
