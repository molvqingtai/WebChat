import { Remesh } from 'remesh'
import type { RoomTransport } from '@/runtime/RoomTransport'
import { NativeWireCodec, type WireCodec } from '@/protocol'

const notImplemented = (name: string) => () => {
  throw new Error(`"${name}" not implemented.`)
}

export const WireCodecExtern = Remesh.extern<WireCodec>({ default: NativeWireCodec })

export const RoomTransportExtern = Remesh.extern<RoomTransport>({
  default: {
    peerIdOf: notImplemented('peerIdOf'),
    join: notImplemented('join'),
    leave: notImplemented('leave'),
    peers: notImplemented('peers'),
    send: notImplemented('send'),
    onMessage: notImplemented('onMessage'),
    onPeerJoin: notImplemented('onPeerJoin'),
    onPeerLeave: notImplemented('onPeerLeave'),
    onRoomClose: notImplemented('onRoomClose'),
    onError: notImplemented('onError'),
    dispose: notImplemented('dispose')
  }
})
