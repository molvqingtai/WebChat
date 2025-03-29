import { defineProxy } from 'comctx'
import PeerRoom from './PeerRoom'
import { RoomMessage } from '@/domain/VirtualRoom'
import Peer from './Peer'
import { stringToHex } from '@/utils'
import { VIRTUAL_ROOM_ID } from '@/constants/config'

export const [provideVirtualRoom, injectVirtualRoom] = defineProxy(
  () => {
    const hostRoomId = stringToHex(VIRTUAL_ROOM_ID)
    return new PeerRoom<RoomMessage>({ roomId: hostRoomId, peer: Peer.createInstance() })
  },
  {
    namespace: `__${__NAME__}__VIRTUAL_ROOM__`
  }
)
