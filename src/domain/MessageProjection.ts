import { MESSAGE_TYPE, REACTION_TYPE } from '@/protocol/ChatRoom'
import type { ChatUser } from '@/protocol/Session'
import {
  MESSAGE_RECORD_TYPE,
  compareEventPosition,
  isChatMessageRecord,
  type ChatMessageRecord,
  type DisplayMessage,
  type MessageRecord,
  type ProjectedTextMessage,
  type ReactionMessageRecord,
  type SystemNoticeMessage,
  type TextMessageRecord
} from '@/domain/Message'

/** Discriminated-union narrowing for the consumer projection (no schema parse). */
const isReactionMessageRecord = (record: ChatMessageRecord): record is ReactionMessageRecord =>
  record.message.type === MESSAGE_TYPE.REACTION

/** Reaction state is LWW per target/user/reaction over the immutable message position. */
const reactionKey = (record: ReactionMessageRecord): string =>
  `${record.message.targetId}\u0000${record.message.userId}\u0000${record.message.reaction}`

export const projectRecords = (records: readonly MessageRecord[]): DisplayMessage[] => {
  const reactionWinners = records.reduce<Map<string, ReactionMessageRecord>>((acc, record) => {
    if (!isChatMessageRecord(record) || !isReactionMessageRecord(record)) return acc
    const reactionRecord = record
    const key = reactionKey(reactionRecord)
    const current = acc.get(key)
    if (!current || compareEventPosition(current.message, reactionRecord.message) < 0) {
      acc.set(key, reactionRecord)
    }
    return acc
  }, new Map())

  const reactionsByTarget = [...reactionWinners.values()].reduce<Map<string, { likes: ChatUser[]; hates: ChatUser[] }>>(
    (acc, record) => {
      if (!record.message.active) return acc
      const reactions = acc.get(record.message.targetId) ?? { likes: [], hates: [] }
      if (record.message.reaction === REACTION_TYPE.LIKE) reactions.likes.push(record.user)
      if (record.message.reaction === REACTION_TYPE.HATE) reactions.hates.push(record.user)
      acc.set(record.message.targetId, reactions)
      return acc
    },
    new Map()
  )

  return records.flatMap((record): DisplayMessage[] => {
    if (record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE) {
      const notice: SystemNoticeMessage = {
        type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
        id: record.id,
        hlc: record.notice.hlc,
        receivedAt: record.receivedAt,
        user: record.user,
        body: record.notice.body,
        noticeType: record.notice.type
      }
      return [notice]
    }
    if (record.message.type === MESSAGE_TYPE.REACTION) return []
    const text: ProjectedTextMessage = {
      ...record.message,
      receivedAt: record.receivedAt,
      author: record.user,
      reactions: reactionsByTarget.get(record.message.id) ?? { likes: [], hates: [] }
    }
    return [text]
  })
}

export const projectTextRecord = (record: TextMessageRecord): ProjectedTextMessage => ({
  ...record.message,
  receivedAt: record.receivedAt,
  author: record.user,
  reactions: { likes: [], hates: [] }
})
