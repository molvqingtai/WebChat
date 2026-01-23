import { Remesh } from 'remesh'
import type { WorldRoomMessage } from '@/protocol'

export interface WorldRoom {
  readonly peerId: string
  readonly roomId: string
  joinRoom: () => WorldRoom
  sendMessage: (message: WorldRoomMessage, id?: string | string[]) => WorldRoom
  onMessage: (callback: (message: WorldRoomMessage) => void) => WorldRoom
  leaveRoom: () => WorldRoom
  onJoinRoom: (callback: (id: string) => void) => WorldRoom
  onLeaveRoom: (callback: (id: string) => void) => WorldRoom
  onError: (callback: (error: Error) => void) => WorldRoom
}

export const WorldRoomExtern = Remesh.extern<WorldRoom>({
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
