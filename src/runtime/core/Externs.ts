import { Remesh } from 'remesh'
import type { ChatMessageRecord } from '@/domain/Message'
import { NativeWireCodec, type WireCodec } from '@/protocol'
import type { RuntimeEvent } from './Contract'
import type { RoomTransport } from './RoomTransport'

const missing = (name: string) => () => {
  throw new Error(`"${name}" not implemented.`)
}

export const RoomTransportExtern = Remesh.extern<RoomTransport>({
  default: {
    peerIdOf: missing('peerIdOf'),
    join: missing('join'),
    leave: missing('leave'),
    send: missing('send'),
    onMessage: missing('onMessage'),
    onPeerJoin: missing('onPeerJoin'),
    onPeerLeave: missing('onPeerLeave'),
    onRoomClose: missing('onRoomClose'),
    onError: missing('onError'),
    dispose: missing('dispose')
  }
})

export const WireCodecExtern = Remesh.extern<WireCodec>({ default: NativeWireCodec })

export const ClockExtern = Remesh.extern<{ now: () => number }>({ default: { now: () => Date.now() } })

export const IdentityExtern = Remesh.extern<{ nextId: () => string }>({ default: { nextId: missing('nextId') } })

/** The Runtime's only way to reach the pages of a site. */
export interface PageGateway {
  persist: (domain: string, records: ChatMessageRecord[], live: boolean) => Promise<number>
  readHistory: (domain: string, cutoff: number) => Promise<ChatMessageRecord[]>
  /** `domain: null` publishes to every page. */
  publish: (domain: string | null, event: RuntimeEvent) => void
}

export const PageGatewayExtern = Remesh.extern<PageGateway>({
  default: { persist: missing('persist'), readHistory: missing('readHistory'), publish: missing('publish') }
})
