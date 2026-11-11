import type { HistorySupplyEvent, HistorySupplyResult, RuntimeServer } from '@/runtime/Contract'

/** Content script → Background. Every message carries the exact Page instance that sent it. */
export const PAGE_SCOPE = 'WEB_CHAT_PAGE_V3' as const
/** Background → Runtime host. The Background adds the browser-owned tab facts. */
export const HOST_SCOPE = 'WEB_CHAT_HOST_V3' as const
/** Runtime host → Background. Delivery is addressed by browser tab id. */
export const HOST_PUSH_SCOPE = 'WEB_CHAT_HOST_PUSH_V3' as const

export type RuntimeMethod = keyof RuntimeServer

export interface PageCall {
  scope: typeof PAGE_SCOPE
  type: 'call'
  pageId: string
  callId: string
  domain: string
  method: RuntimeMethod
  args: unknown[]
}

export interface PageBye {
  scope: typeof PAGE_SCOPE
  type: 'bye'
  pageId: string
}

export type PageMessage = PageCall | PageBye

export interface HostRequest {
  scope: typeof HOST_SCOPE
  type: 'ping' | 'call' | 'tab-gone'
  tabId?: number
  url?: string
  message?: PageCall | PageBye
}

export interface HostResponse {
  ok: boolean
  value?: unknown
  error?: string
}

export interface StateChangedPush {
  scope: typeof HOST_PUSH_SCOPE
  type: 'state-changed'
  /** Every tab with a currently registered Page. The payload is intentionally content-free. */
  tabIds: number[]
}

export interface HistoryPush {
  scope: typeof HOST_PUSH_SCOPE
  type: 'history'
  tabId: number
  event: HistorySupplyEvent
}

export interface HistoryReply {
  scope: typeof HOST_SCOPE
  type: 'call'
  tabId: number
  url?: string
  message: {
    scope: typeof PAGE_SCOPE
    type: 'call'
    pageId: string
    callId: string
    domain: string
    method: 'resolveHistorySupply' | 'rejectHistorySupply'
    args: unknown[]
  }
}

export type HostPush = StateChangedPush | HistoryPush

export const isPageMessage = (value: unknown): value is PageMessage => {
  if (!value || typeof value !== 'object') return false
  const message = value as { scope?: unknown; type?: unknown }
  if (message.scope !== PAGE_SCOPE) return false
  return message.type === 'call' || message.type === 'bye'
}

export const isHostRequest = (value: unknown): value is HostRequest => {
  if (!value || typeof value !== 'object') return false
  const message = value as { scope?: unknown; type?: unknown }
  return (
    message.scope === HOST_SCOPE && (message.type === 'ping' || message.type === 'call' || message.type === 'tab-gone')
  )
}

export const isHostPush = (value: unknown): value is HostPush => {
  if (!value || typeof value !== 'object') return false
  const message = value as { scope?: unknown; type?: unknown }
  return message.scope === HOST_PUSH_SCOPE && (message.type === 'state-changed' || message.type === 'history')
}

export const isHostResponse = (value: unknown): value is HostResponse => {
  if (!value || typeof value !== 'object') return false
  const response = value as { ok?: unknown }
  return typeof response.ok === 'boolean'
}

export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}

export type HistoryReplyResult = HistorySupplyResult
