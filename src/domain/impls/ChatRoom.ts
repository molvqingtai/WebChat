import type { Room } from '@rtco/client'

import { ChatRoomExtern } from '@/domain/externs/ChatRoom'
import { stringToHex } from '@/utils'
import EventHub from '@resreq/event-hub'
import type { ChatRoomMessage } from '@/protocol'
import { JSONR } from '@/utils'
import Peer from './Peer'

export interface Config {
  peer: Peer
  roomId: string
}

class ChatRoom extends EventHub {
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

  sendMessage(message: ChatRoomMessage, id?: string | string[]) {
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

  onMessage(callback: (message: ChatRoomMessage) => void) {
    try {
      if (!this.room) {
        this.once('action', async () => {
          if (!this.room) {
            throw new Error('Room not joined')
          } else {
            this.room.on('message', (message) => callback(JSONR.parse(message) as ChatRoomMessage))
          }
        })
      } else {
        this.room.on('message', (message) => callback(JSONR.parse(message) as ChatRoomMessage))
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

const hostRoomId = stringToHex(document.location.host)

const chatRoom = new ChatRoom({ roomId: hostRoomId, peer: Peer.createInstance() })

export const ChatRoomImpl = ChatRoomExtern.impl(chatRoom)

// https://github.com/w3c/webextensions/issues/72
// https://issues.chromium.org/issues/40251342
// https://github.com/w3c/webrtc-extensions/issues/77
// https://github.com/aklinker1/webext-core/pull/70
