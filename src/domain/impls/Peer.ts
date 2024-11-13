import { nanoid } from 'nanoid'
import { Artico } from '@rtco/client'

export interface Config {
  peerId?: string
}

export default class Peer extends Artico {
  private static instance: Peer | null = null
  private constructor(config: Config = {}) {
    const { peerId = nanoid() } = config
    super({ id: peerId })
  }

  public static createInstance(config: Config = {}) {
    return (this.instance ??= new Peer(config))
  }

  public static getInstance() {
    return this.instance
  }
}
