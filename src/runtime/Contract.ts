import type { ChatMessageRecord, ReactionMessageRecord, TextMessageRecord } from '@/domain/Message'
import type { ChatMessage, MentionedUser, ChatUser, ReactionType, ChatSite, WorldRoomMessage } from '@/protocol'

export type HostPhase = 'none' | 'connecting' | 'ready' | 'unavailable'

export interface RuntimeSession {
  sourcePeerId: string
  sessionId: string
  user: ChatUser
  joinedAt: number
}

export interface DomainSnapshot {
  domain: string
  phase: 'active' | 'grace'
  pageIds: string[]
  chatRoomJoined: boolean
  localSession?: Omit<RuntimeSession, 'sourcePeerId'>
  sessions: RuntimeSession[]
}

export interface WorldPresenceRecord {
  sourcePeerId: string
  presence: WorldRoomMessage
}

export interface WorldSnapshot {
  joined: boolean
  peerId: string
  localPresence?: WorldRoomMessage
  presences: WorldPresenceRecord[]
}

export interface RuntimeSnapshot {
  /** Changes whenever the physical Offscreen/Background Runtime is recreated. */
  hostId: string
  hostPhase: HostPhase
  peerId: string
  domains: DomainSnapshot[]
  world: WorldSnapshot
}

export interface InboundEvent {
  sequence: number
  domain: string
  record: ChatMessageRecord
  source: 'live' | 'history'
  /** All sequences from one history response share a batch id for durable page ACK backpressure. */
  batchId?: string
}

export interface RuntimeSessionSnapshot {
  localSession?: Omit<RuntimeSession, 'sourcePeerId'>
  sessions: RuntimeSession[]
}

export type RuntimeSessionEvent =
  | {
      type: 'snapshot'
      domain: string
      snapshot: RuntimeSessionSnapshot
      provenance: 'join' | 'reconnect' | 'recovery' | 'refresh'
    }
  | {
      type: 'join'
      domain: string
      snapshot: RuntimeSessionSnapshot
      session: RuntimeSession
      provenance: 'live'
    }
  | {
      type: 'leave'
      domain: string
      snapshot: RuntimeSessionSnapshot
      session: RuntimeSession
      occurredAt: number
      provenance: 'live'
    }
  | {
      type: 'replace'
      domain: string
      snapshot: RuntimeSessionSnapshot
      previous: RuntimeSession
      session: RuntimeSession
      occurredAt: number
      provenance: 'live'
    }

export interface WorldPresenceEvent {
  presence: WorldPresenceRecord | null
  sourcePeerId: string
}

export interface HistorySupplyRequest {
  supplyId: string
  domain: string
  syncId: string
  /** Frozen from the provider's own clock at admission; the snapshot never re-reads time. */
  cutoff: number
  /** 'inventory' returns the requester's eligible record ids; 'provider' returns eligible records. */
  mode: 'inventory' | 'provider'
}

export interface HistorySupplyResult {
  records: ChatMessageRecord[]
  done: boolean
}

export type HistorySupplyEvent =
  | { type: 'request'; request: HistorySupplyRequest }
  | { type: 'cancel'; supplyId: string }

/** One attempt-owned History loading owner projected to same-domain pages. */
export interface HistoryFeedbackEvent {
  domain: string
  /** Complete attempt identity, so one sync can never dismiss another or an unrelated Toast. */
  ownerId: string
  type: 'loading' | 'dismiss'
}

export interface RuntimeErrorEvent {
  eventId: string
  message: string
  /** Runtime boundary that produced this presentation event. */
  subsystem: 'connection'
  /** The current operation at that boundary; this never participates in control flow. */
  operation: 'lifecycle' | 'send' | 'history'
  /** Exact failure scope carried to the content so presentation is never cross-domain. */
  scope?: string
}

export interface RuntimeServer {
  attachPage: (payload: { domain: string; pageId: string }) => Promise<RuntimeSnapshot>
  detachPage: (payload: { domain: string; pageId: string }) => Promise<void>
  getSnapshot: () => Promise<RuntimeSnapshot>
  joinChatRoom: (payload: { domain: string; user: ChatUser; site: ChatSite }) => Promise<RuntimeSnapshot | null>
  leaveChatRoom: (payload: { domain: string }) => Promise<void>
  allocateTextMessage: (payload: {
    domain: string
    body: string
    mentions: MentionedUser[]
  }) => Promise<TextMessageRecord>
  allocateReactionMessage: (payload: {
    domain: string
    targetId: string
    reaction: ReactionType
    active: boolean
  }) => Promise<ReactionMessageRecord>
  sendChatMessage: (payload: { domain: string; event: ChatMessage }) => Promise<void>
  ackInbound: (payload: { domain: string; sequence: number; inserted: boolean }) => Promise<void>
  replayInbound: (payload: { domain: string; after: number }) => Promise<InboundEvent[]>
  reconnectDomain: (payload: { domain: string }) => Promise<void | null>
  onInbound: (payload: { pageId: string }, callback: (event: InboundEvent) => void | Promise<void>) => Promise<void>
  onSessionEvent: (
    payload: { pageId: string },
    callback: (event: RuntimeSessionEvent) => void | Promise<void>
  ) => Promise<void>
  onWorldPresence: (payload: { pageId: string }, callback: (event: WorldPresenceEvent) => void) => Promise<void>
  onError: (payload: { pageId: string }, callback: (event: RuntimeErrorEvent) => void) => Promise<void>
  onHistoryFeedback: (payload: { pageId: string }, callback: (event: HistoryFeedbackEvent) => void) => Promise<void>
  provideHistory: (
    payload: { domain: string; pageId: string },
    callback: (event: HistorySupplyEvent) => void
  ) => Promise<void>
  resolveHistorySupply: (payload: { pageId: string; supplyId: string; result: HistorySupplyResult }) => Promise<void>
  rejectHistorySupply: (payload: { pageId: string; supplyId: string; reason: string }) => Promise<void>
}

export const RUNTIME_NAMESPACE_PREFIX = 'WEB_CHAT_RUNTIME_V2' as const

export interface RuntimeHostStatus {
  phase: HostPhase
  generation: number
}

export interface RuntimeTab {
  id?: number
  url?: string
}

export interface RuntimePageRegistration extends RuntimeHostStatus {
  snapshot: RuntimeSnapshot
  failures?: RuntimeErrorEvent[]
}

export interface RuntimeCoordinator {
  ensureHost: () => Promise<RuntimeHostStatus>
  registerPage: (payload: { domain: string; pageId: string }) => Promise<RuntimePageRegistration>
}

export const COORDINATOR_NAMESPACE = 'WEB_CHAT_RUNTIME_COORDINATOR_V2' as const
