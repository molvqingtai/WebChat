import { Remesh } from 'remesh'
import type { ChatRoomTextMessage } from '@/protocol'

export interface Notification {
  push: (message: ChatRoomTextMessage) => Promise<string | void>
}

export const NotificationExtern = Remesh.extern<Notification>({
  default: {
    push: () => {
      throw new Error('"push" not implemented.')
    }
  }
})
