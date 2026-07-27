import { Remesh } from 'remesh'
import type { ChatUser } from '@/protocol'

export const MAX_PRESENCE_OBSERVATIONS = 512

export type PresenceStatus = 'active' | 'ended'

export interface LocalPresenceLease {
  presenceId: string
  userId: string
  joinedAt: number
  status: 'pending' | 'active'
}

export interface PendingPresenceEnd {
  presenceId: string
  userId: string
  joinedAt: number
}

export interface ObservedPresence {
  presenceId: string
  sessionId: string
  user: ChatUser
  joinedAt: number
  status: PresenceStatus
}

export interface PresenceDomainRecord {
  domain: string
  lastJoinedAt: number
  local?: LocalPresenceLease
  inflightEnd?: PendingPresenceEnd
  pendingEnd?: PendingPresenceEnd
  settledEnd?: PendingPresenceEnd
  observers: ObservedPresence[]
}

export interface PresenceStore {
  load(domain: string): Promise<PresenceDomainRecord | null>
  save(record: PresenceDomainRecord): Promise<void>
}

const notImplemented = () => Promise.reject(new Error('PresenceStore not implemented'))

export const PresenceStoreExtern = Remesh.extern<PresenceStore>({
  default: { load: notImplemented, save: notImplemented }
})
