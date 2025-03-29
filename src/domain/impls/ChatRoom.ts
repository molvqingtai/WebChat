import { ChatRoomExtern } from '@/domain/externs/ChatRoom'
import { InjectAdapter } from '@/service/PeerRoom/adapter/InjectAdapter'
import { injectChatRoom } from '@/service/PeerRoom/ChatRoom'
import { browser } from 'wxt/browser'

const chatRoom = injectChatRoom(new InjectAdapter(browser.runtime.getURL('/shared-worker.js')))

export const ChatRoomImpl = ChatRoomExtern.impl(chatRoom)

// https://github.com/w3c/webextensions/issues/72
// https://issues.chromium.org/issues/40251342
// https://github.com/w3c/webrtc-extensions/issues/77
// https://github.com/aklinker1/webext-core/pull/70
