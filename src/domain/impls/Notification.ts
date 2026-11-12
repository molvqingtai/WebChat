import { browser } from '#imports'
import { NotificationExtern, type Notification } from '@/domain/externs/Notification'
import { InjectAdapter } from '@/service/adapter/runtime'
import { defineNotificationProxy } from '@/service/Contract'

// SAFETY: the proxy factory placeholder is replaced by the injected Notification implementation.
const [, injectNotification] = defineNotificationProxy(() => ({}) as Notification, browser.runtime.id)

const notification = injectNotification(new InjectAdapter())

export const NotificationImpl = NotificationExtern.impl(notification)
