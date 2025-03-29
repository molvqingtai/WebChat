import { VirtualRoomExtern } from '@/domain/externs/VirtualRoom'
import { InjectAdapter } from '@/service/PeerRoom/adapter/InjectAdapter'
import { injectVirtualRoom } from '@/service/PeerRoom/VirtualRoom'
import { browser } from 'wxt/browser'

const virtualRoom = injectVirtualRoom(new InjectAdapter(browser.runtime.getURL('/shared-worker.js')))

export const VirtualRoomImpl = VirtualRoomExtern.impl(virtualRoom)
