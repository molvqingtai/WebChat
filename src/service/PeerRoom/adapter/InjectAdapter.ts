import { Adapter, SendMessage, OnMessage, Message } from 'comctx'
// import SharedWorker from '@/shared-worker?sharedworker&inline'

export class InjectAdapter implements Adapter {
  // @ts-expect-error none
  worker: SharedWorker
  constructor(path: string | URL) {
    fetch(path).then(async (res) => {
      const url = URL.createObjectURL(await res.blob())
      console.log('url', url)
      this.worker = new SharedWorker(url, { type: 'module' })
      // this.worker = new SharedWorker()
      this.worker.port.start()
    })
    // this.worker = new SharedWorker(path, { type: 'module', credentials: 'omit' })
    // this.worker = new SharedWorker()
    // this.worker.port.start()
  }
  sendMessage: SendMessage = (message) => {
    console.log('SendMessage', this.worker.port)

    this.worker.port.postMessage(message)
  }
  onMessage: OnMessage = (callback) => {
    const handler = (event: MessageEvent<Message>) => callback(event.data)
    this.worker.port.addEventListener('message', handler)
    return () => {
      this.worker.port.removeEventListener('message', handler)
    }
  }
}
