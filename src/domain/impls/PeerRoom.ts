import { type DataPayload, type Room } from 'trystero'
import { joinRoom } from 'trystero/nostr'
// import { joinRoom } from 'trystero/firebase'
import { PeerRoomExtern, type PeerMessage } from '@/domain/externs/PeerRoom'
import { stringToHex } from '@/utils'

export interface Config {
  appId: string
}

class PeerRoom {
  readonly appId: string
  room: Room | null
  constructor(config: Config) {
    this.appId = config.appId
    this.room = null
  }

  async joinRoom(roomId: string) {
    this.room = joinRoom({ appId: this.appId }, roomId)

    this.room?.onPeerJoin((peerId) => console.log(`${peerId} joined`))

    console.log(this.room.getPeers())

    return this.room
  }

  async sendMessage<T extends PeerMessage>(message: T) {
    const [send] = this.room!.makeAction('MESSAGE')
    return await send(message as DataPayload)
  }

  onMessage<T extends PeerMessage>(callback: (message: T) => void) {
    const [, on] = this.room!.makeAction('MESSAGE')
    on((message) => callback(message as T))
  }

  async leaveRoom() {
    return await this.room?.leave()
  }
}

const peerRoom = new PeerRoom({ appId: stringToHex(__NAME__) })

export const PeerRoomImpl = PeerRoomExtern.impl(peerRoom)
