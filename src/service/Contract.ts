import { defineProxy } from 'comctx'
import type { AppAction } from '@/domain/externs/AppAction'
import type { Notification } from '@/domain/externs/Notification'

export const NOTIFICATION_NAMESPACE_V1 = 'WEB_CHAT_NOTIFICATION_V1' as const
export const APP_ACTION_NAMESPACE_V1 = 'WEB_CHAT_APP_ACTION_V1' as const

export const defineNotificationProxy = (provider: () => Notification, runtimeId: string) =>
  defineProxy<() => Notification>(provider, {
    namespace: `${NOTIFICATION_NAMESPACE_V1}:${runtimeId}`
  })

export const defineAppActionProxy = (provider: () => AppAction, runtimeId: string) =>
  defineProxy<() => AppAction>(provider, {
    namespace: `${APP_ACTION_NAMESPACE_V1}:${runtimeId}`
  })
