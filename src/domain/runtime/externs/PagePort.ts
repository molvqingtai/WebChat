import { Remesh } from 'remesh'
import type {
  HistorySupplyRequest,
  HistorySupplyResult,
  InboundEvent,
  RuntimeSessionEvent,
  WorldPresenceEvent
} from '@/runtime/Contract'

export interface PagePort {
  removePage: (pageId: string) => void
  historyPageIds: (domain: string) => string[]
  emitInbound: (pageIds: string[], event: InboundEvent) => Promise<string[]>
  emitSessionEvent: (pageIds: string[], event: RuntimeSessionEvent) => Promise<string[]>
  emitWorldPresence: (pageIds: string[], event: WorldPresenceEvent) => Promise<string[]>
  emitError: (pageIds: string[], error: Error) => Promise<string[]>
  supplyHistory: (pageId: string, request: HistorySupplyRequest) => Promise<HistorySupplyResult | null>
  cancelHistorySupply: (supplyId: string) => Promise<void>
}

const notImplemented = (name: string) => async () => {
  throw new Error(`"${name}" not implemented.`)
}

export const PagePortExtern = Remesh.extern<PagePort>({
  default: {
    removePage: () => {},
    historyPageIds: () => [],
    emitInbound: notImplemented('emitInbound'),
    emitSessionEvent: notImplemented('emitSessionEvent'),
    emitWorldPresence: notImplemented('emitWorldPresence'),
    emitError: notImplemented('emitError'),
    supplyHistory: notImplemented('supplyHistory'),
    cancelHistorySupply: async () => {}
  }
})
