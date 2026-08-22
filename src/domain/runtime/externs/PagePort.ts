import { Remesh } from 'remesh'
import type { HistorySupplyRequest, HistorySupplyResult } from '@/runtime/Contract'

export interface PagePort {
  removePage: (tabId: number) => void
  historyPageIds: (domain: string) => string[]
  isHistoryProvider: (tabId: number, domain: string) => boolean
  supplyHistory: (providerId: string, request: HistorySupplyRequest) => Promise<HistorySupplyResult | null>
  cancelHistorySupply: (supplyId: string) => Promise<void>
}

const notImplemented = (name: string) => async () => {
  throw new Error(`"${name}" not implemented.`)
}

export const PagePortExtern = Remesh.extern<PagePort>({
  default: {
    removePage: () => {},
    historyPageIds: () => [],
    isHistoryProvider: () => false,
    supplyHistory: notImplemented('supplyHistory'),
    cancelHistorySupply: async () => {}
  }
})
