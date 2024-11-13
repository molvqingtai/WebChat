import { EVENT } from '@/constants/event'
import { defineExtensionMessaging } from '@webext-core/messaging'
import { TextMessage } from '@/domain/ChatRoom'

interface ProtocolMap {
  [EVENT.OPTIONS_PAGE_OPEN]: () => void
  [EVENT.NOTIFICATION_PUSH]: (message: TextMessage) => void
  [EVENT.NOTIFICATION_CLEAR]: (id: string) => void
}

export const messenger = defineExtensionMessaging<ProtocolMap>()
