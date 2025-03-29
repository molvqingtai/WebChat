import { defineProxy } from 'comctx'
import { stringToHex } from '@/utils'
import PeerRoom from './PeerRoom'
import { RoomMessage } from '@/domain/ChatRoom'
import Peer from './Peer'

export const [provideChatRoom, injectChatRoom] = defineProxy(
  () => {
    const hostRoomId = stringToHex(new URL(self.location.href).host)
    return new PeerRoom<RoomMessage>({ roomId: hostRoomId, peer: Peer.createInstance() })
  },
  {
    namespace: `__${__NAME__}__CHAT_ROOM__`
  }
)
