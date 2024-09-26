import { type DataPayload, type Room, joinRoom, selfId } from 'trystero'

// import { joinRoom } from 'trystero/firebase'

import { PeerRoomExtern, type PeerMessage } from '@/domain/externs/PeerRoom'
import { stringToHex } from '@/utils'
import EventHub from '@resreq/event-hub'

export interface Config {
  peerId?: string
  roomId: string
}

class PeerRoom extends EventHub {
  readonly appId: string
  private room?: Room
  readonly roomId: string
  readonly peerId: string
  constructor(config: Config) {
    super()
    this.appId = __NAME__
    this.roomId = config.roomId
    this.peerId = selfId
    this.joinRoom = this.joinRoom.bind(this)
    this.sendMessage = this.sendMessage.bind(this)
    this.onMessage = this.onMessage.bind(this)
    this.onJoinRoom = this.onJoinRoom.bind(this)
    this.onLeaveRoom = this.onLeaveRoom.bind(this)
    this.leaveRoom = this.leaveRoom.bind(this)
    this.onError = this.onError.bind(this)
  }

  joinRoom() {
    this.room = joinRoom({ appId: this.appId }, this.roomId)
    /**
     * If we wait to join, it will result in not being able to listen to our own join event.
     * This might be related to the fact that:
     * (If called more than once, only the latest callback registered is ever called.)
     * Multiple listeners may overwrite each other.
     * @see: https://github.com/dmotz/trystero?tab=readme-ov-file#onpeerjoincallback
     */
    // this.room.onPeerJoin(() => this.emit('action'))
    this.emit('action')
    return this
  }

  sendMessage<T extends PeerMessage>(message: T, id?: string) {
    if (!this.room) {
      this.once('action', () => {
        if (!this.room) {
          this.emit('error', new Error('Room not joined'))
        } else {
          const [send] = this.room.makeAction('MESSAGE')
          send(message as DataPayload, id)
        }
      })
    } else {
      const [send] = this.room.makeAction('MESSAGE')
      send(message as DataPayload, id)
    }

    return this
  }

  onMessage<T extends PeerMessage>(callback: (message: T) => void) {
    if (!this.room) {
      this.once('action', () => {
        if (!this.room) {
          this.emit('error', new Error('Room not joined'))
        } else {
          const [, on] = this.room.makeAction('MESSAGE')
          on((message) => callback(message as T))
        }
      })
    } else {
      const [, on] = this.room.makeAction('MESSAGE')
      on((message) => callback(message as T))
    }
    return this
  }

  onJoinRoom(callback: (id: string) => void) {
    if (!this.room) {
      this.once('action', () => {
        if (!this.room) {
          this.emit('error', new Error('Room not joined'))
        } else {
          this.room.onPeerJoin((peerId) => {
            callback(peerId)
          })
        }
      })
    } else {
      this.room.onPeerJoin((peerId) => {
        callback(peerId)
      })
    }
    return this
  }

  onLeaveRoom(callback: (id: string) => void) {
    if (!this.room) {
      this.once('action', () => {
        if (!this.room) {
          this.emit('error', new Error('Room not joined'))
        } else {
          this.room.onPeerLeave((peerId) => callback(peerId))
        }
      })
    } else {
      this.room.onPeerLeave((peerId) => callback(peerId))
    }
    return this
  }

  leaveRoom() {
    if (!this.room) {
      this.once('action', () => {
        if (!this.room) {
          this.emit('error', new Error('Room not joined'))
        } else {
          this.room.leave()
          this.room = undefined
        }
      })
    } else {
      this.room.leave()
      this.room = undefined
    }
    return this
  }

  onError(callback: (error: Error) => void) {
    this.on('error', (error: Error) => callback(error))
    return this
  }
}

const hostRoomId = stringToHex(document.location.host)
const peerRoom = new PeerRoom({ roomId: hostRoomId })

export const PeerRoomImpl = PeerRoomExtern.impl(peerRoom)

// https://github.com/w3c/webextensions/issues/72
// https://issues.chromium.org/issues/40251342
// https://github.com/w3c/webrtc-extensions/issues/77
