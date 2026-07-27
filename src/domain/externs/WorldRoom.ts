import { Remesh } from 'remesh'
import type { ChatUser, ChatSite } from '@/protocol'

export type WorldState = Array<ChatSite & { users: ChatUser[] }>

export interface WorldRoom {
  getState: () => Promise<WorldState>
  onState: (callback: (state: WorldState) => void) => () => void
  onError: (callback: (error: Error) => void) => () => void
}

const notImplemented = (name: string) => () => {
  throw new Error(`"${name}" not implemented.`)
}

export const WorldRoomExtern = Remesh.extern<WorldRoom>({
  default: {
    getState: notImplemented('getState'),
    onState: notImplemented('onState'),
    onError: notImplemented('onError')
  }
})
