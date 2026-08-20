import { Remesh } from 'remesh'
import type {
  HistoryFeedbackEvent,
  HistorySupplyRequest,
  HistorySupplyResult,
  InboundEvent,
  RuntimeErrorEvent,
  RuntimeSessionEvent,
  WorldPresenceEvent
} from '@/runtime/Contract'

export interface PagePort {
  removePage: (pageId: string) => void
  beginSessionEvent: (pageId: string, callback: (event: RuntimeSessionEvent) => void | Promise<void>) => number
  activateSessionEvent: (pageId: string, generation: number) => boolean
  cancelSessionEvent: (pageId: string, generation: number) => void
  isSessionEventActive: (pageId: string, generation: number) => boolean
  historyPageIds: (domain: string) => string[]
  emitInbound: (pageIds: string[], event: InboundEvent) => Promise<string[]>
  emitSessionEvent: (pageIds: string[], event: RuntimeSessionEvent) => Promise<string[]>
  emitWorldPresence: (pageIds: string[], event: WorldPresenceEvent) => Promise<string[]>
  emitError: (pageIds: string[], event: RuntimeErrorEvent) => Promise<string[]>
  emitHistoryFeedback: (pageIds: string[], event: HistoryFeedbackEvent) => Promise<string[]>
  supplyHistory: (pageId: string, request: HistorySupplyRequest) => Promise<HistorySupplyResult | null>
  cancelHistorySupply: (supplyId: string) => Promise<void>
}

const notImplemented = (name: string) => async () => {
  throw new Error(`"${name}" not implemented.`)
}

export const PagePortExtern = Remesh.extern<PagePort>({
  default: {
    removePage: () => {},
    beginSessionEvent: () => {
      throw new Error('"beginSessionEvent" not implemented.')
    },
    activateSessionEvent: () => false,
    cancelSessionEvent: () => {},
    isSessionEventActive: () => false,
    historyPageIds: () => [],
    emitInbound: notImplemented('emitInbound'),
    emitSessionEvent: notImplemented('emitSessionEvent'),
    emitWorldPresence: notImplemented('emitWorldPresence'),
    emitError: notImplemented('emitError'),
    emitHistoryFeedback: notImplemented('emitHistoryFeedback'),
    supplyHistory: notImplemented('supplyHistory'),
    cancelHistorySupply: async () => {}
  }
})
