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
  /** Changes whenever the Background-owned logical Runtime is recreated. */
  hostId: string
  hostPhase: HostPhase
  peerId: string
  domains: DomainSnapshot[]
  world: WorldSnapshot
}

/** Browser-delivery facts replace all Page-provided caller claims at the provider boundary. */
export interface RuntimeCaller {
  tab?: RuntimeTab
}

/**
 * Private-by-convention fields added by the Page facade and provider adapter. They are intentionally
 * optional in the public port so isolated domain tests can keep constructing their local fake port.
 */
export interface RuntimePageCall {
  pageId?: string
  runtimeHostId?: string
  caller?: RuntimeCaller
  /** Service-private immutable identity of the Page binding that issued this call. */
  bindingId?: string
  /**
   * Service-private correlation for one Background-initiated Page rebind. It is never attached
   * to business Runtime calls or peer protocol frames.
   */
  rebindId?: string
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
  attachPage: (payload: { domain: string; pageId: string } & RuntimePageCall) => Promise<RuntimeSnapshot>
  detachPage: (payload: { domain: string; pageId: string } & RuntimePageCall) => Promise<void>
  getSnapshot: () => Promise<RuntimeSnapshot>
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
  replayInbound: (payload: { domain: string; after: number } & RuntimePageCall) => Promise<InboundEvent[]>
  reconnectDomain: (payload: { domain: string } & RuntimePageCall) => Promise<void | null>
  onInbound: (
    payload: { pageId: string } & RuntimePageCall,
    callback: (event: InboundEvent) => void | Promise<void>
  ) => Promise<void>
  onSessionEvent: (
    payload: { pageId: string } & RuntimePageCall,
    callback: (event: RuntimeSessionEvent) => void | Promise<void>
  ) => Promise<void>
  onWorldPresence: (
    payload: { pageId: string } & RuntimePageCall,
    callback: (event: WorldPresenceEvent) => void
  ) => Promise<void>
  onError: (
    payload: { pageId: string } & RuntimePageCall,
    callback: (event: RuntimeErrorEvent) => void
  ) => Promise<void>
  onHistoryFeedback: (
    payload: { pageId: string } & RuntimePageCall,
    callback: (event: HistoryFeedbackEvent) => void
  ) => Promise<void>
  provideHistory: (
    payload: { domain: string; pageId: string } & RuntimePageCall,
    callback: (event: HistorySupplyEvent) => void
  ) => Promise<void>
  resolveHistorySupply: (
    payload: { pageId: string; supplyId: string; result: HistorySupplyResult } & RuntimePageCall
  ) => Promise<void>
  rejectHistorySupply: (
    payload: { pageId: string; supplyId: string; reason: string } & RuntimePageCall
  ) => Promise<void>
}

export const RUNTIME_NAMESPACE_PREFIX = 'WEB_CHAT_RUNTIME_V2' as const

export interface RuntimeTab {
  id?: number
  url?: string
}

export interface RuntimePageRegistration {
  snapshot: RuntimeSnapshot
  failures?: RuntimeErrorEvent[]
  /** Returned only by registration and retained by the Page facade for private call fencing. */
  bindingId?: string
  /** Echoed only to the initiating private rebind control-plane request. */
  rebindId?: string
}

export interface RuntimeCoordinator {
  registerPage: (payload: { domain: string; pageId: string } & RuntimePageCall) => Promise<RuntimePageRegistration>
}

export const COORDINATOR_NAMESPACE = 'WEB_CHAT_RUNTIME_COORDINATOR_V2' as const
