import Peer, { type DataConnection } from 'peerjs'
import { nanoid } from 'nanoid'
import { PeerClientExtern } from '../domain/externs/PeerClient'

class PeerClient {
  private peer: Peer | undefined
  private connection: DataConnection | undefined

  async connect(id: string) {
    const connect = (id: string) => {
      this.peer = new Peer(nanoid())
      this.peer.on('connection', (e) => {
        console.log('connection2', e)
      })
      const connection = this.peer.connect(id)
      connection.on('open', () => {
        console.log('connection open')

        this.connection = connection
      })
      connection.on('error', (error) => {
        console.log('error', error)
      })
    }

    this.peer = new Peer(id)
    this.peer.on('connection', (e) => {
      console.log('connection1', e)
    })
    this.peer.on('open', (e) => {
      console.log('open', e)
      this.peer!.on('connection', (e) => {
        console.log('connection1', e)
      })
    })
    this.peer.on('error', (error) => {
      if (error.type === 'unavailable-id') {
        console.log('unavailable-id')

        connect(id)
      }
    })

    // return await new Promise((resolve, reject) => {
    //   try {
    //     this.peer = new Peer(id)
    //     this.peer.on('connection', (e) => {
    //       console.log('connection1', e)
    //     })
    //     this.peer
    //       .once('open', (e) => {
    //         resolve(e)
    //       })
    //       .once('error', (error) => {
    //         if (error.type === 'unavailable-id') {
    //           const connection = this.peer!.connect(id)!
    //           connection
    //             .once('open', () => {
    //               console.log('open')
    //               console.log('connection', connection)
    //               this.connection = connection
    //               resolve(id)
    //             })
    //             .once('error', (error) => {
    //               reject(error)
    //             })
    //         } else {
    //           debugger
    //           reject(error)
    //         }
    //       })
    //   } catch (error) {
    //     reject(error)
    //   }
    // })
  }

  async sendMessage(message: string) {
    return await new Promise<void>((resolve, reject) => {
      if (this.connection) {
        this.connection.send(message)
        resolve(undefined)
      } else {
        reject(new Error('Connection not established.'))
      }
    })
  }

  onMessage(callback: (message: string) => void) {
    this.connection?.on('data', (data: any) => {
      // callback(data)
    })
  }

  close() {
    this.connection?.close()
  }
}

export const PeerClientImpl = PeerClientExtern.impl(new PeerClient())
