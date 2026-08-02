import { Remesh } from 'remesh'
import type { Unsubscribe } from '@/domain/Subscription'
import type { ChatMessage, ChatSession, ChatSite, ChatUser, MentionedUser } from '@/protocol'

export interface JoinRoomCommand {
  user: ChatUser
  site: ChatSite
}

export interface SendTextCommand {
  type: 'text'
  body: string
  mentions: MentionedUser[]
}

export interface SendReactionCommand {
  type: 'reaction'
  targetId: string
  reaction: 'like' | 'hate'
  active: boolean
}

export type SendMessageCommand = SendTextCommand | SendReactionCommand

export interface ChatRoom {
  joinRoom(command: JoinRoomCommand): Promise<void>
  leaveRoom(): Promise<void>
  sendMessage(command: SendMessageCommand): Promise<ChatMessage>
  onMessage(listener: (message: ChatMessage) => void): Unsubscribe
  onJoinRoom(listener: (session: ChatSession) => void): Unsubscribe
  onLeaveRoom(listener: (session: ChatSession) => void): Unsubscribe
  onSessions(listener: (sessions: readonly ChatSession[]) => void): Unsubscribe
  onError(listener: (error: Error) => void): Unsubscribe
}

const notImplemented = (name: string) => () => {
  throw new Error(`"${name}" not implemented.`)
}

export const ChatRoomExtern = Remesh.extern<ChatRoom>({
  default: {
    joinRoom: notImplemented('joinRoom'),
    leaveRoom: notImplemented('leaveRoom'),
    sendMessage: notImplemented('sendMessage'),
    onMessage: notImplemented('onMessage'),
    onJoinRoom: notImplemented('onJoinRoom'),
    onLeaveRoom: notImplemented('onLeaveRoom'),
    onSessions: notImplemented('onSessions'),
    onError: notImplemented('onError')
  }
})
