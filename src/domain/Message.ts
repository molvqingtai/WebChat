import type { ChatMessage, HLC, ReactionMessage, TextMessage } from '@/protocol/ChatRoom'
import type { ChatUser } from '@/protocol/Session'

export const NOTICE_TYPE = {
  JOIN: 'join',
  LEAVE: 'leave',
  INFO: 'info'
} as const

export type NoticeType = (typeof NOTICE_TYPE)[keyof typeof NOTICE_TYPE]

export const MESSAGE_RECORD_TYPE = {
  CHAT_MESSAGE: 'chat-message',
  SYSTEM_NOTICE: 'system-notice'
} as const

export interface ChatMessageRecord<Message extends ChatMessage = ChatMessage> {
  readonly type: typeof MESSAGE_RECORD_TYPE.CHAT_MESSAGE
  readonly id: string
  readonly message: Message
  readonly user: ChatUser
  readonly receivedAt: number
}

export type TextMessageRecord = ChatMessageRecord<TextMessage>
export type ReactionMessageRecord = ChatMessageRecord<ReactionMessage>

export interface Notice {
  readonly id: string
  readonly hlc: HLC
  readonly type: NoticeType
  readonly body: string
}

export interface SystemNoticeRecord {
  readonly type: typeof MESSAGE_RECORD_TYPE.SYSTEM_NOTICE
  readonly id: string
  readonly notice: Notice
  readonly user: ChatUser
  readonly receivedAt: number
}

export type MessageRecord = ChatMessageRecord | SystemNoticeRecord

/** UI-only projection. Reactions are derived from immutable ReactionMessage records. */
export interface ProjectedTextMessage extends TextMessage {
  receivedAt: number
  author: ChatUser
  reactions: {
    likes: ChatUser[]
    hates: ChatUser[]
  }
}

export interface SystemNoticeMessage {
  type: typeof MESSAGE_RECORD_TYPE.SYSTEM_NOTICE
  id: string
  hlc: HLC
  receivedAt: number
  user: ChatUser
  body: string
  noticeType: NoticeType
}

export type DisplayMessage = ProjectedTextMessage | SystemNoticeMessage

/** Message id breaks equal-HLC ties into the total order required by cursors and reaction LWW. */
export const compareHLC = (left: HLC, right: HLC): number =>
  left.timestamp === right.timestamp ? left.counter - right.counter : left.timestamp - right.timestamp

export const compareEventPosition = (
  left: Pick<ChatMessage, 'hlc' | 'id'>,
  right: Pick<ChatMessage, 'hlc' | 'id'>
): number => compareHLC(left.hlc, right.hlc) || (left.id === right.id ? 0 : left.id < right.id ? -1 : 1)

export const isChatMessageRecord = (record: MessageRecord): record is ChatMessageRecord =>
  record.type === MESSAGE_RECORD_TYPE.CHAT_MESSAGE

export const getMessageRecordHLC = (record: MessageRecord): HLC =>
  isChatMessageRecord(record) ? record.message.hlc : record.notice.hlc

export const compareMessageRecordPosition = (left: MessageRecord, right: MessageRecord): number =>
  compareHLC(getMessageRecordHLC(left), getMessageRecordHLC(right)) ||
  (left.id === right.id ? 0 : left.id < right.id ? -1 : 1)
