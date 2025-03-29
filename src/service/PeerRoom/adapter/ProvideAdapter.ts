import { Adapter, SendMessage, OnMessage, Message } from 'comctx'

declare const self: SharedWorkerGlobalScope

export default class ProvideAdapter implements Adapter {
  private clients = new Set<MessagePort>()

  sendMessage: SendMessage = (message) => {
    this.clients.forEach((client) => {
      console.log('client', client, message)

      client.postMessage(message)
    })
  }

  onMessage: OnMessage = (callback) => {
    const handler = (event: MessageEvent<Message>) => callback(event.data)

    self.addEventListener('connect', (event: MessageEvent) => {
      const [port] = event.ports
      port.addEventListener('message', handler)
      port.addEventListener('close', () => this.clients.delete(port))
      port.start()
      this.clients.add(port)
    })

    return () => {
      this.clients.forEach((client) => client.removeEventListener('message', handler))
      this.clients.clear()
    }
  }
}
