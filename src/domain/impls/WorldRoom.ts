import type { Room } from '@rtco/client'

import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import { stringToHex } from '@/utils'
import EventHub from '@resreq/event-hub'
import type { WorldRoomMessage } from '@/protocol'
import { JSONR } from '@/utils'
import { WORLD_ROOM_ID } from '@/constants/config'
import Peer from './Peer'

export interface Config {
  peer: Peer
  roomId: string
}

class WorldRoom extends EventHub {
  readonly peer: Peer
  readonly roomId: string
  readonly peerId: string
  private room?: Room

  constructor(config: Config) {
    super()
    this.peer = config.peer
    this.roomId = config.roomId
    this.peerId = config.peer.id
    this.joinRoom = this.joinRoom.bind(this)
    this.sendMessage = this.sendMessage.bind(this)
    this.onMessage = this.onMessage.bind(this)
    this.onJoinRoom = this.onJoinRoom.bind(this)
    this.onLeaveRoom = this.onLeaveRoom.bind(this)
    this.leaveRoom = this.leaveRoom.bind(this)
    this.onError = this.onError.bind(this)
  }

  joinRoom() {
    try {
      if (this.room) {
        this.room = this.peer.join(this.roomId)
      } else {
        if (this.peer.state === 'ready') {
          this.room = this.peer.join(this.roomId)
          this.emit('action')
        } else {
          this.peer!.on('open', () => {
            this.room = this.peer.join(this.roomId)
            this.emit('action')
          })
        }
      }
    } catch (error) {
      this.emit('error', error)
    }
    return this
  }

  sendMessage(message: WorldRoomMessage, id?: string | string[]) {
    try {
      if (!this.room) {
        this.once('action', async () => {
          if (!this.room) {
            throw new Error('Room not joined')
          } else {
            this.room.send(JSONR.stringify(message)!, id)
          }
        })
      } else {
        this.room.send(JSONR.stringify(message)!, id)
      }
    } catch (error) {
      this.emit('error', error)
    }
    return this
  }

  onMessage(callback: (message: WorldRoomMessage) => void) {
    try {
      if (!this.room) {
        this.once('action', async () => {
          if (!this.room) {
            throw new Error('Room not joined')
          } else {
            this.room.on('message', (message) => callback(JSONR.parse(message) as WorldRoomMessage))
          }
        })
      } else {
        this.room.on('message', (message) => callback(JSONR.parse(message) as WorldRoomMessage))
      }
    } catch (error) {
      this.emit('error', error)
    }
    return this
  }

  onJoinRoom(callback: (id: string) => void) {
    try {
      if (!this.room) {
        this.once('action', async () => {
          if (!this.room) {
            throw new Error('Room not joined')
          } else {
            this.room.on('join', (id) => callback(id))
          }
        })
      } else {
        this.room.on('join', (id) => callback(id))
      }
    } catch (error) {
      this.emit('error', error)
    }
    return this
  }

  onLeaveRoom(callback: (id: string) => void) {
    try {
      if (!this.room) {
        this.once('action', async () => {
          if (!this.room) {
            throw new Error('Room not joined')
          } else {
            this.room.on('leave', (id) => callback(id))
          }
        })
      } else {
        this.room.on('leave', (id) => callback(id))
      }
    } catch (error) {
      this.emit('error', error)
    }
    return this
  }

  leaveRoom() {
    try {
      if (!this.room) {
        this.once('action', async () => {
          if (!this.room) {
            throw new Error('Room not joined')
          } else {
            this.room.leave()
            this.room = undefined
          }
        })
      } else {
        this.room.leave()
        this.room = undefined
      }
    } catch (error) {
      this.emit('error', error)
    }
    return this
  }
  onError(callback: (error: Error) => void) {
    this.peer?.on('error', (error) => callback(error))
    this.on('error', (error: Error) => callback(error))
    return this
  }
}

const hostRoomId = stringToHex(WORLD_ROOM_ID)

const worldRoom = new WorldRoom({ roomId: hostRoomId, peer: Peer.createInstance() })

export const WorldRoomImpl = WorldRoomExtern.impl(worldRoom)
