import { Remesh } from 'remesh'
import type { TextMessage } from '@/domain/ChatRoom'

export interface Notification {
  push: (message: TextMessage) => Promise<string | void>
}

export const NotificationExtern = Remesh.extern<Notification>({
  default: {
    push: () => {
      throw new Error('"push" not implemented.')
    }
  }
})
