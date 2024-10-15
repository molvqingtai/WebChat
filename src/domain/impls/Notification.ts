import { NotificationExtern } from '@/domain/externs/Notification'
import { TextMessage } from '../Room'
import { EVENT } from '@/constants/event'
import { messenger } from '@/messenger'

class Notification {
  async push(message: TextMessage) {
    await messenger.sendMessage(EVENT.NOTIFICATION_PUSH, message)
    return message.id
  }
}

export const NotificationImpl = NotificationExtern.impl(new Notification())
