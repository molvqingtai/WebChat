import { type DataPayload, type Room, joinRoom, selfId } from 'trystero'

// import { joinRoom } from 'trystero/firebase'
import { PeerRoomExtern, type PeerMessage } from '@/domain/externs/PeerRoom'
import { stringToHex } from '@/utils'

export interface Config {
  appId: string
}

class PeerRoom {
  readonly appId: string
  room: Room | null
  readonly selfId: string
  constructor(config: Config) {
    this.appId = config.appId
    this.room = null
    this.selfId = selfId
  }

  async joinRoom(roomId: string) {
    this.room = joinRoom({ appId: this.appId }, roomId)

    return this.room
  }

  async sendMessage<T extends PeerMessage>(message: T) {
    if (!this.room) {
      throw new Error('Room not joined')
    }
    const [send] = this.room!.makeAction('MESSAGE')
    return await send(message as DataPayload)
  }

  onMessage<T extends PeerMessage>(callback: (message: T) => void) {
    if (!this.room) {
      throw new Error('Room not joined')
    }
    const [, on] = this.room!.makeAction('MESSAGE')
    on((message) => callback(message as T))
  }

  onJoinRoom(callback: (id: string) => void) {
    if (!this.room) {
      throw new Error('Room not joined')
    }
    this.room.onPeerJoin((peerId) => callback(peerId))
  }

  onLeaveRoom(callback: (id: string) => void) {
    if (!this.room) {
      throw new Error('Room not joined')
    }
    this.room.onPeerLeave((peerId) => callback(peerId))
  }

  getRoomPeers() {
    if (!this.room) {
      throw new Error('Room not joined')
    }
    return Object.keys(this.room.getPeers()).map((id) => id)
  }

  async leaveRoom() {
    return await this.room?.leave()
  }
}

const peerRoom = new PeerRoom({ appId: stringToHex(__NAME__) })

export const PeerRoomImpl = PeerRoomExtern.impl(peerRoom)
