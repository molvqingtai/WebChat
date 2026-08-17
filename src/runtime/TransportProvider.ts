import type { RoomTransport } from '@/runtime/RoomTransport'
import { createArticoRoomTransport } from '@/runtime/ArticoRoomTransport'
import { createTrysteroRoomTransport } from '@/runtime/TrysteroRoomTransport'

type RoomTransportProvider = 'artico' | 'trystero'

/** The single provider switch: the whole product uses whichever adapter this constant selects. */
const ROOM_TRANSPORT_PROVIDER: RoomTransportProvider = 'trystero'

/** The sole production composition point for the peer transport; hosts never import a peer library. */
export const createRoomTransport = (): RoomTransport =>
  ROOM_TRANSPORT_PROVIDER === 'trystero' ? createTrysteroRoomTransport() : createArticoRoomTransport()
