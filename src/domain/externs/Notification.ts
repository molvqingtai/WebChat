import { Remesh } from 'remesh'
import { TextMessage } from '../Room'

export interface Notification {
  push: (message: TextMessage) => Promise<string>
  clear: (id: string) => Promise<boolean>
}

export const NotificationExtern = Remesh.extern<Notification>({
  default: {
    push: () => {
      throw new Error('"push" not implemented.')
    },
    clear: () => {
      throw new Error('"clear" not implemented.')
    }
  }
})
