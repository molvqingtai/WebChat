import { Remesh } from 'remesh'
import type { ProjectedTextMessage } from '@/domain/Message'

export interface Notification {
  push: (message: ProjectedTextMessage) => Promise<string | void>
}

export const NotificationExtern = Remesh.extern<Notification>({
  default: {
    push: () => {
      throw new Error('"push" not implemented.')
    }
  }
})
