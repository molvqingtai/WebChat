import { Remesh } from 'remesh'
import { TextMessage } from '../Room'

export interface Notification {
  push: (message: TextMessage) => Promise<string>
}

export const NotificationExtern = Remesh.extern<Notification>({
  default: {
    push: () => {
      throw new Error('"push" not implemented.')
    }
  }
})
