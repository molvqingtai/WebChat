import { Artico, Room } from '@rtco/client'

import { PeerRoomExtern } from '@/domain/externs/PeerRoom'
import { stringToHex } from '@/utils'
import { nanoid } from 'nanoid'
import EventHub from '@resreq/event-hub'
import { RoomMessage } from '../Room'
export interface Config {
  peerId?: string
  roomId: string
}

class PeerRoom extends EventHub {
  readonly roomId: string
  private rtco?: Artico
  readonly peerId: string
  private room?: Room

  constructor(config: Config) {
    super()
    this.roomId = config.roomId
    this.peerId = config.peerId || nanoid()
    this.joinRoom = this.joinRoom.bind(this)
    this.sendMessage = this.sendMessage.bind(this)
    this.onMessage = this.onMessage.bind(this)
    this.onJoinRoom = this.onJoinRoom.bind(this)
    this.onLeaveRoom = this.onLeaveRoom.bind(this)
    this.leaveRoom = this.leaveRoom.bind(this)
    this.onError = this.onError.bind(this)
  }

  joinRoom() {
    if (!this.rtco) {
      this.rtco = new Artico({ id: this.peerId })
    }
    if (this.room) {
      this.room = this.rtco.join(this.roomId)
    } else {
      this.rtco!.on('open', () => {
        this.room = this.rtco!.join(this.roomId)
        this.emit('action')
      })
    }
    return this
  }

  sendMessage(message: RoomMessage, id?: string) {
    if (!this.room) {
      this.once('action', () => {
        if (!this.room) {
          this.emit('error', new Error('Room not joined'))
        } else {
          this.room.send(JSON.stringify(message), id)
        }
      })
    } else {
      this.room.send(JSON.stringify(message), id)
    }
    return this
  }

  onMessage(callback: (message: RoomMessage) => void) {
    if (!this.room) {
      this.once('action', () => {
        if (!this.room) {
          this.emit('error', new Error('Room not joined'))
        } else {
          this.room.on('message', (message) => callback(JSON.parse(message) as RoomMessage))
        }
      })
    } else {
      this.room.on('message', (message) => callback(JSON.parse(message) as RoomMessage))
    }
    return this
  }

  onJoinRoom(callback: (id: string) => void) {
    if (!this.room) {
      this.once('action', () => {
        if (!this.room) {
          this.emit('error', new Error('Room not joined'))
        } else {
          this.room.on('join', (id) => callback(id))
        }
      })
    } else {
      this.room.on('join', (id) => callback(id))
    }
    return this
  }

  onLeaveRoom(callback: (id: string) => void) {
    if (!this.room) {
      this.once('action', () => {
        if (!this.room) {
          this.emit('error', new Error('Room not joined'))
        } else {
          this.room.on('leave', (id) => callback(id))
        }
      })
    } else {
      this.room.on('leave', (id) => callback(id))
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
    this.rtco?.on('error', (error) => callback(error))
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
