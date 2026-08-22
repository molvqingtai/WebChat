import type { ChatMessageRecord, ReactionMessageRecord, TextMessageRecord } from '@/domain/Message'
import type { ChatMessage, MentionedUser, ChatUser, ReactionType, ChatSite, WorldRoomMessage } from '@/protocol'

export type HostPhase = 'none' | 'connecting' | 'ready' | 'unavailable'

export interface RuntimeSession {
  sourcePeerId: string
  sessionId: string
  user: ChatUser
  joinedAt: number
}

export interface InboundEvent {
  sequence: number
  domain: string
  record: ChatMessageRecord
  source: 'live' | 'history'
  /** All sequences from one history response share a batch id for durable page ACK backpressure. */
  batchId?: string
}

export interface HistoryFeedbackState {
  /** Complete attempt identity, so one sync can never dismiss another or an unrelated Toast. */
  ownerId: string
}

export interface DomainSnapshot {
  domain: string
  phase: 'active' | 'grace'
  tabIds: number[]
  chatRoomJoined: boolean
  localSession?: Omit<RuntimeSession, 'sourcePeerId'> & {
    /** True only when the current local generation was newly allocated (self-notice eligibility). */
    fresh?: boolean
  }
  sessions: RuntimeSession[]
  /** Current retained inbound facts awaiting durable Page persistence. */
  inbound: InboundEvent[]
  /** Active History loading owners; present only when the reading tab supplies History. */
  historyFeedback: HistoryFeedbackState[]
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

export interface RuntimeSnapshot {
  /** Changes whenever the Background-owned logical Runtime is recreated. */
  hostId: string
  hostPhase: HostPhase
  peerId: string
  domains: DomainSnapshot[]
  world: WorldSnapshot
  /** Bounded current Runtime failure facts; a Page presents each unseen eventId at most once. */
  failures: RuntimeErrorEvent[]
}

/** Browser-delivery facts replace all Page-provided caller claims at the provider boundary. */
export interface RuntimeCaller {
  tab?: RuntimeTab
}

/**
 * Private-by-convention fields added by the provider adapter. They are intentionally
 * optional in the public port so isolated domain tests can keep constructing their local fake port.
 */
export interface RuntimePageCall {
  caller?: RuntimeCaller
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

export interface RuntimeServer {
  attachPage: (payload: { domain: string } & RuntimePageCall) => Promise<RuntimeSnapshot>
  getSnapshot: (payload: { domain?: string } & RuntimePageCall) => Promise<RuntimeSnapshot>
  joinChatRoom: (
    payload: { domain: string; user: ChatUser; site: ChatSite } & RuntimePageCall
  ) => Promise<RuntimeSnapshot | null>
  leaveChatRoom: (payload: { domain: string } & RuntimePageCall) => Promise<void>
  allocateTextMessage: (
    payload: {
      domain: string
      body: string
      mentions: MentionedUser[]
    } & RuntimePageCall
  ) => Promise<TextMessageRecord>
  allocateReactionMessage: (
    payload: {
      domain: string
      targetId: string
      reaction: ReactionType
      active: boolean
    } & RuntimePageCall
  ) => Promise<ReactionMessageRecord>
  sendChatMessage: (payload: { domain: string; event: ChatMessage } & RuntimePageCall) => Promise<ChatMessage>
  ackInbound: (payload: { domain: string; sequence: number; inserted: boolean } & RuntimePageCall) => Promise<void>
  reconnectDomain: (payload: { domain: string } & RuntimePageCall) => Promise<void | null>
  provideHistory: (
    payload: { domain: string } & RuntimePageCall,
    callback: (event: HistorySupplyEvent) => void
  ) => Promise<void>
  resolveHistorySupply: (payload: { supplyId: string; result: HistorySupplyResult } & RuntimePageCall) => Promise<void>
  rejectHistorySupply: (payload: { supplyId: string; reason: string } & RuntimePageCall) => Promise<void>
}

export const RUNTIME_NAMESPACE_PREFIX = 'WEB_CHAT_RUNTIME_V2' as const

export interface RuntimeTab {
  id?: number
  url?: string
}

export interface RuntimePageRegistration {
  snapshot: RuntimeSnapshot
}

export interface RuntimeCoordinator {
  registerPage: (payload: { domain: string } & RuntimePageCall) => Promise<RuntimePageRegistration>
}

export const COORDINATOR_NAMESPACE = 'WEB_CHAT_RUNTIME_COORDINATOR_V2' as const

/** The complete Runtime-to-Page notification is intentionally content-free. */
export const STATE_CHANGED_MESSAGE_TYPE = 'runtime:state-changed' as const
