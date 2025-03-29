import { Remesh } from 'remesh'
import { RoomMessage } from '@/domain/ChatRoom'

export interface ChatRoom {
  readonly peerId: string
  readonly roomId: string
  joinRoom: () => void
  sendMessage: (message: RoomMessage, id?: string | string[]) => void
  onMessage: (callback: (message: RoomMessage) => void) => void
  leaveRoom: () => void
  onJoinRoom: (callback: (id: string) => void) => void
  onLeaveRoom: (callback: (id: string) => void) => void
  onError: (callback: (error: Error) => void) => void
}

export const ChatRoomExtern = Remesh.extern<ChatRoom>({
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
