import { Remesh } from 'remesh'
import { RoomMessage } from '../ChatRoom'

export interface ChatRoom {
  readonly peerId: string
  readonly roomId: string
  joinRoom: () => ChatRoom
  sendMessage: (message: RoomMessage, id?: string | string[]) => ChatRoom
  onMessage: (callback: (message: RoomMessage) => void) => ChatRoom
  leaveRoom: () => ChatRoom
  onJoinRoom: (callback: (id: string) => void) => ChatRoom
  onLeaveRoom: (callback: (id: string) => void) => ChatRoom
  onError: (callback: (error: Error) => void) => ChatRoom
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
