import { NotificationExtern, type Notification } from '@/domain/externs/Notification'

import { InjectAdapter } from '@/service/adapter/runtimeMessage'
import { defineProxy } from 'comctx'

const [, injectNotification] = defineProxy(() => ({}) as Notification)

const notification = injectNotification(new InjectAdapter())

export const NotificationImpl = NotificationExtern.impl(notification)
