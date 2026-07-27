import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import AppActionDomain from '@/domain/AppAction'
import type { ProjectedTextMessage } from '@/domain/Message'
import NotificationDomain from '@/domain/Notification'
import ProfileFeedbackDomain from '@/domain/ProfileFeedback'
import { AppActionExtern } from '@/domain/externs/AppAction'
import { NotificationExtern } from '@/domain/externs/Notification'
import { ToastExtern, type Toast } from '@/domain/externs/Toast'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

afterEach(() => vi.restoreAllMocks())

describe('application commands', () => {
  it('opens options through AppActionDomain', async () => {
    const openOptionsPage = vi.fn(async () => {})
    const store = Remesh.store({ externs: [AppActionExtern.impl({ openOptionsPage })] })
    const action = AppActionDomain()
    const domain = store.getDomain(action)
    store.igniteDomain(action)

    store.send(domain.command.OpenOptionsCommand())
    await vi.waitFor(() => expect(openOptionsPage).toHaveBeenCalledTimes(1))
    store.discard()
  })

  it('keeps the options command stream alive after an RPC rejection', async () => {
    const openOptionsPage = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(undefined)
    const store = Remesh.store({ externs: [AppActionExtern.impl({ openOptionsPage })] })
    const action = AppActionDomain()
    const domain = store.getDomain(action)
    store.igniteDomain(action)

    store.send(domain.command.OpenOptionsCommand())
    await vi.waitFor(() => expect(openOptionsPage).toHaveBeenCalledTimes(1))
    await settle()
    store.send(domain.command.OpenOptionsCommand())
    await vi.waitFor(() => expect(openOptionsPage).toHaveBeenCalledTimes(2))
    store.discard()
  })

  it('contains each notification rejection without terminating later requests', async () => {
    const failure = new Error('notification unavailable')
    const push = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce('notification-id')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = Remesh.store({ externs: [NotificationExtern.impl({ push })] })
    const action = NotificationDomain()
    const domain = store.getDomain(action)
    const message = { id: 'notification-message', body: 'hello' } as ProjectedTextMessage
    const events: ProjectedTextMessage[] = []
    store.subscribeEvent(domain.event.PushEvent, (event) => events.push(event))

    store.send(domain.command.PushCommand(message))
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    await settle()
    store.send(domain.command.PushCommand(message))
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(2))

    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith('[WebChat] Notification push failed:', failure)
    expect(events).toEqual([message, message])
    store.discard()
  })

  it('routes profile feedback through the existing Toast capability', async () => {
    const toast = {
      success: vi.fn(() => 1),
      warning: vi.fn(() => 2),
      error: vi.fn(() => 3),
      info: vi.fn(() => 4),
      loading: vi.fn(() => 5),
      cancel: vi.fn(() => 6)
    } satisfies Toast
    const store = Remesh.store({ externs: [ToastExtern.impl(toast)] })
    const action = ProfileFeedbackDomain()
    const domain = store.getDomain(action)
    store.igniteDomain(action)

    store.send(domain.command.SuccessCommand('saved'))
    store.send(domain.command.WarningCommand('warning'))
    store.send(domain.command.ErrorCommand('error'))
    await settle()

    expect(toast.success).toHaveBeenCalledWith('saved')
    expect(toast.warning).toHaveBeenCalledWith('warning')
    expect(toast.error).toHaveBeenCalledWith('error')
    store.discard()
  })
})
