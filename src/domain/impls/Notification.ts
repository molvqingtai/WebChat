import { browser } from '#imports'
import { NotificationExtern, type Notification } from '@/domain/externs/Notification'
import { InjectAdapter } from '@/service/adapter/runtime'
import { defineNotificationProxy } from '@/service/Contract'

const [, injectNotification] = defineNotificationProxy(() => ({}) as Notification, browser.runtime.id)

const notification = injectNotification(new InjectAdapter())

export const NotificationImpl = NotificationExtern.impl(notification)
