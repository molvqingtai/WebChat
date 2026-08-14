import { describe, expect, it, vi } from 'vitest'
import {
  CdpClient,
  evaluateRuntimeMessage,
  terminateOwnedProcesses,
  waitForUniqueTarget,
  withDeadline
} from './chrome-harness.ts'

type FakeEvent = Record<string, unknown>
type FakeListener = (event: FakeEvent) => void

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  listeners = new Map<string, FakeListener[]>()
  sent: string[] = []

  constructor() {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emit(type: string, event: FakeEvent = {}): void {
    ;(this.listeners.get(type) ?? []).forEach((listener) => {
      listener(event)
    })
  }

  send(message: string): void {
    this.sent.push(message)
  }

  close(): void {
    this.emit('close')
  }
}

describe('Chrome Runtime harness', () => {
  it('propagates sender-visible Runtime message rejection', async () => {
    const evaluate = vi.fn<(expression: string) => Promise<boolean>>().mockRejectedValue(new Error('raw rejected'))

    await expect(evaluateRuntimeMessage(evaluate, null)).rejects.toThrow('raw rejected')
    expect(evaluate).toHaveBeenCalledWith('chrome.runtime.sendMessage(null)')
  })

  it('rejects a CDP command that never settles and clears its pending request', async () => {
    const client = new CdpClient('ws://test', { WebSocketImpl: FakeWebSocket, requestTimeoutMs: 10 })
    const socket = FakeWebSocket.instances.at(-1)!
    const connected = client.connect()
    socket.emit('open')
    await connected

    await expect(client.send('Runtime.evaluate')).rejects.toThrow(
      'Timed out waiting for CDP Runtime.evaluate after 10ms'
    )
    expect(client.pending.size).toBe(0)
    client.close()
  })

  it('bounds the whole suite and invokes its targeted timeout hook', async () => {
    const onTimeout = vi.fn()
    await expect(withDeadline(new Promise(() => {}), 10, 'Chrome Runtime suite', onTimeout)).rejects.toThrow(
      'Timed out waiting for Chrome Runtime suite after 10ms'
    )
    expect(onTimeout).toHaveBeenCalledOnce()
  })

  it('waits while a target is absent and accepts the first unique target', async () => {
    const target = { id: 'only-target' }
    const candidates = vi.fn<() => { id: string }[]>().mockReturnValueOnce([]).mockReturnValueOnce([target])

    await expect(
      waitForUniqueTarget(candidates, { timeoutMs: 100, intervalMs: 0, label: 'WebChat test target' })
    ).resolves.toBe(target)
    expect(candidates).toHaveBeenCalledTimes(2)
  })

  it('fails closed on multiple targets without accepting a later singleton', async () => {
    const first = { id: 'first-target' }
    const candidates = vi
      .fn<() => { id: string }[]>()
      .mockReturnValueOnce([first, { id: 'second-target' }])
      .mockReturnValue([first])

    await expect(
      waitForUniqueTarget(candidates, { timeoutMs: 100, intervalMs: 0, label: 'WebChat test target' })
    ).rejects.toThrow('Expected one WebChat test target, received 2')
    expect(candidates).toHaveBeenCalledOnce()
  })

  it('terminates a matching profile child even when the browser root exited first', async () => {
    let residualProcesses = [{ pid: 202, command: 'chrome --user-data-dir=/tmp/owned-profile' }]
    const signalProcessGroup = vi.fn()
    const signalProcess = vi.fn((pid: number, signal: NodeJS.Signals) => {
      if (pid === 202 && signal === 'SIGTERM') residualProcesses = []
    })

    const result = await terminateOwnedProcesses({
      rootPid: 101,
      isRootExited: () => true,
      listOwnedProcesses: () => residualProcesses,
      signalProcessGroup,
      signalProcess,
      sleep: async () => {}
    })

    expect(signalProcessGroup).toHaveBeenCalledWith(101, 'SIGTERM')
    expect(signalProcess).toHaveBeenCalledWith(202, 'SIGTERM')
    expect(signalProcessGroup).not.toHaveBeenCalledWith(101, 'SIGKILL')
    expect(result).toEqual({ rootExited: true, residualProcesses: [] })
  })

  it('escalates only the owned process group and matching profile PIDs after TERM', async () => {
    let rootExited = false
    let residualProcesses = [{ pid: 202, command: 'chrome --user-data-dir=/tmp/owned-profile' }]
    const signalProcessGroup = vi.fn((_pid: number, signal: NodeJS.Signals) => {
      if (signal === 'SIGKILL') rootExited = true
    })
    const signalProcess = vi.fn((_pid: number, signal: NodeJS.Signals) => {
      if (signal === 'SIGKILL') residualProcesses = []
    })

    const result = await terminateOwnedProcesses({
      rootPid: 101,
      isRootExited: () => rootExited,
      listOwnedProcesses: () => residualProcesses,
      signalProcessGroup,
      signalProcess,
      termTimeoutMs: 0,
      sleep: async () => {}
    })

    expect(signalProcessGroup.mock.calls).toEqual([
      [101, 'SIGTERM'],
      [101, 'SIGKILL']
    ])
    expect(signalProcess.mock.calls).toEqual([
      [202, 'SIGTERM'],
      [202, 'SIGKILL']
    ])
    expect(result).toEqual({ rootExited: true, residualProcesses: [] })
  })
})
