import { browser } from '#imports'
import { NotificationExtern, type Notification } from '@/domain/externs/Notification'

import { InjectAdapter } from '@/service/adapter/runtimeMessage'
import { defineProxy } from 'comctx'

const [, injectNotification] = defineProxy(() => ({}) as Notification, {
  namespace: browser.runtime.id
})

const notification = injectNotification(new InjectAdapter())

export const NotificationImpl = NotificationExtern.impl(notification)
