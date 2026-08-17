import { afterEach, describe, expect, it, vi } from 'vitest'
import { Artico, type Signaling } from '@rtco/client'

interface FakeChannel {
  label: string
  readyState: RTCDataChannelState
  sent: string[]
  onopen: (() => void) | null
  onclose: (() => void) | null
  onerror: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  send(value: string): void
  close(): void
}

const channels: FakeChannel[] = []

class FakeSignaling {
  readonly id = 'local-peer'
  readonly state = 'ready'
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  on(event: string, listener: (...args: unknown[]) => void) {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  off(event: string, listener: (...args: unknown[]) => void) {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  emit(event: string, ...args: unknown[]) {
    ;(this.listeners.get(event) ?? []).forEach((listener) => listener(...args))
    return true
  }

  connect() {}
  disconnect() {}
  signal() {}
  join() {}
}

class FakePeerConnection {
  signalingState: RTCSignalingState = 'stable'
  iceConnectionState: RTCIceConnectionState = 'new'
  iceGatheringState: RTCIceGatheringState = 'new'
  localDescription: RTCSessionDescription | null = null
  onnegotiationneeded: (() => void) | null = null
  onicecandidate: (() => void) | null = null
  onicecandidateerror: (() => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  ontrack: (() => void) | null = null
  ondatachannel: (() => void) | null = null
  onicegatheringstatechange: (() => void) | null = null

  createDataChannel(label: string): RTCDataChannel {
    const channel: FakeChannel = {
      label,
      readyState: 'connecting',
      sent: [],
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
      send(value) {
        this.sent.push(value)
      },
      close() {
        this.readyState = 'closed'
      }
    }
    channels.push(channel)
    return channel as unknown as RTCDataChannel
  }

  close() {}
  getSenders() {
    return []
  }
  addTrack() {}
  removeTrack() {}
  async setLocalDescription() {}
  async setRemoteDescription() {}
  async addIceCandidate() {}
  restartIce() {}
}

afterEach(() => {
  channels.length = 0
  vi.unstubAllGlobals()
})

describe('pinned Artico ready-to-closing behavior', () => {
  it('rethrows the first failure while still delivering to later ready peers', () => {
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
    const signaling = new FakeSignaling() as unknown as Signaling
    const artico = new Artico({ signaling, debug: 0 })
    const room = artico.join('room-a')

    signaling.emit('join', 'room-a', 'closing-peer')
    signaling.emit('join', 'room-a', 'ready-peer')
    channels.forEach((channel) => {
      channel.readyState = 'open'
      channel.onopen?.()
    })
    channels[0].readyState = 'closing'

    // A target-array send attempts every selected peer: the closing peer's original error is
    // rethrown as-is, and later ready peers still receive the payload.
    expect(() => room.send('batched', ['closing-peer', 'ready-peer'])).toThrow('Connection is not established yet.')
    expect(channels[1].sent).toEqual(['batched'])

    expect(() => room.send('isolated', 'closing-peer')).toThrow('Connection is not established yet.')
    expect(() => room.send('isolated', 'ready-peer')).not.toThrow()
    expect(channels[1].sent).toEqual(['batched', 'isolated'])
  })
})
