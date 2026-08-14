import type { Message, SystemNoticeMessage } from '@/domain/MessageList'

export interface NoticeGroup {
  type: 'notice-group'
  id: string
  notices: readonly SystemNoticeMessage[]
}

export type GroupedMessage<T extends Message = Message> = T | NoticeGroup

export const messageRowKey = (message: GroupedMessage): string => {
  if (message.type === 'text') return `message:${message.id}`
  if (message.type === 'notice-group') return message.id
  return `single-notice:${message.id}`
}

export const groupAdjacentNotices = <T extends Message>(messages: readonly T[]): GroupedMessage<T>[] => {
  const grouped: GroupedMessage<T>[] = []
  // functional-loop: continue — text messages pass through while adjacent notice runs group by index
  for (let index = 0; index < messages.length; ) {
    const message = messages[index]
    if (message.type === 'text') {
      grouped.push(message)
      index += 1
      continue
    }

    const notices: SystemNoticeMessage[] = []
    // functional-loop: condition-driven — the notice run ends at the next text message
    while (index < messages.length && messages[index].type !== 'text') {
      notices.push(messages[index] as SystemNoticeMessage)
      index += 1
    }
    if (notices.length === 1) grouped.push(notices[0] as T)
    else grouped.push({ type: 'notice-group', id: `notice-group:${notices[0].id}`, notices })
  }
  return grouped
}
