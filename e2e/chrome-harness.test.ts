import { describe, expect, it, vi } from 'vitest'
import {
  CdpClient,
  createChromeTeardown,
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
    ;(this.listeners.get(type) ?? []).forEach((listener) => listener(event))
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

  it('runs the live close composition in order and keeps the run failure primary', async () => {
    const timeoutFailure = new Error('timeout close failed')
    const browserFailure = new Error('Browser.close rejected')
    const finalFailure = new Error('final CDP close failed')
    const primary = new Error('product assertion failed')
    const order: string[] = []
    const errors: Parameters<typeof createChromeTeardown>[0]['errors'] = []
    const teardown = createChromeTeardown({
      errors,
      cleanupTimeoutMs: 1000,
      hasCdp: () => true,
      closeCdp: () => {
        const phase = order.length === 0 ? 'timeout-close' : 'final-close'
        order.push(phase)
        throw phase === 'timeout-close' ? timeoutFailure : finalFailure
      },
      closeBrowser: async () => {
        order.push('browser-close')
        throw browserFailure
      },
      waitForBrowserExit: async () => {
        order.push('graceful-exit')
      },
      remainingAttempts: () => [
        {
          resource: 'chromium-processes',
          phase: 'terminate-owned',
          run: () => {
            order.push('terminate-owned')
          }
        },
        {
          resource: 'profile',
          phase: 'remove',
          run: () => {
            order.push('remove')
          }
        },
        {
          resource: 'profile',
          phase: 'verify-removed',
          run: () => {
            order.push('verify-removed')
          }
        }
      ],
      cleanupComplete: () => {
        order.push('cleanup-gate')
        return false
      }
    })

    teardown.timeoutClose()
    const result = await teardown.finish(primary)

    expect(order).toEqual([
      'timeout-close',
      'browser-close',
      'final-close',
      'graceful-exit',
      'terminate-owned',
      'remove',
      'verify-removed',
      'cleanup-gate'
    ])
    expect(
      errors.map(({ resource, phase, message, deadlineAt }) => ({
        resource,
        phase,
        message,
        deadlineAt
      }))
    ).toEqual([
      { resource: 'cdp', phase: 'timeout-close', message: timeoutFailure.message, deadlineAt: expect.any(Number) },
      { resource: 'browser', phase: 'browser-close', message: browserFailure.message, deadlineAt: expect.any(Number) },
      { resource: 'cdp', phase: 'final-close', message: finalFailure.message, deadlineAt: expect.any(Number) }
    ])
    expect(new Set(errors.map(({ deadlineAt }) => deadlineAt)).size).toBe(1)
    expect(result.cleanupError).toEqual(new Error('Owned Chromium cleanup failed'))
    expect(result.terminalError).toBe(primary)
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
