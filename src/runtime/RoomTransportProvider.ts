import { ROOM_TRANSPORT_PROVIDER } from '@/constants/config'
import { createRoomTransport as createArticoRoomTransport } from '@/runtime/transports/artico/RoomTransport'
import { createRoomTransport as createTrysteroRoomTransport } from '@/runtime/transports/trystero/RoomTransport'

export const createRoomTransport = () =>
  ROOM_TRANSPORT_PROVIDER === 'artico' ? createArticoRoomTransport() : createTrysteroRoomTransport()
