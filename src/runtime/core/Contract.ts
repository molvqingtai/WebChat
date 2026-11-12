import type { Message } from 'comctx'
import type { ChatMessageRecord } from '@/domain/Message'
import type { ChatSession, ChatSite, ChatUser, MentionedUser, ReactionType } from '@/protocol'

/** One connected page as the core sees it. Hosts wrap a chrome Port or a MessagePort into this. */
export interface Channel {
  readonly domain: string
  post: (frame: Message) => void
  onMessage: (listener: (frame: Message) => void) => () => void
  onClose: (listener: () => void) => () => void
  close: () => void
}

/** Thrown by a locator when no host can ever be reached from this page again. */
export class HostUnavailableError extends Error {}

/** Page side: the one thing that differs between hosts. Wakes the host when needed. */
export interface HostLocator {
  connect: () => Promise<Channel>
}

export interface RuntimeSession extends ChatSession {
  joinedAt: number
}

export type WorldSites = Array<ChatSite & { users: ChatUser[] }>

export type SendCommand =
  | { type: 'text'; body: string; mentions: MentionedUser[] }
  | { type: 'reaction'; targetId: string; reaction: ReactionType; active: boolean }

/** Runtime pushes to page. Every push carries the full current value. */
export type RuntimeEvent =
  | { type: 'sessions'; local: RuntimeSession; remote: RuntimeSession[] }
  | { type: 'world'; sites: WorldSites }
  | { type: 'history'; syncIds: string[] }
  | { type: 'error'; message: string }

/** Page calls Runtime. The page replays `join` after every (re)connect; it is idempotent. */
export interface RuntimeService {
  /**
   * A page that was joined before passes the presence it got back then, so a restarted host
   * continues the same presence and peers see no leave and join.
   */
  join: (input: {
    user: ChatUser
    site: ChatSite
    resume?: { presenceId: string; joinedAt: number }
  }) => Promise<RuntimeSession & { presenceId: string }>
  reconnect: () => Promise<void>
  send: (command: SendCommand) => Promise<ChatMessageRecord>
}

/** Runtime calls page. The message store stays in the page's own origin. */
export interface PageService {
  /** Inserts if absent; `live` inserts raise the page's message event. Returns how many were new. */
  persist: (records: ChatMessageRecord[], live: boolean) => Promise<number>
  readHistory: (cutoff: number) => Promise<ChatMessageRecord[]>
  publish: (event: RuntimeEvent) => void
}
