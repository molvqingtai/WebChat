import type { Database } from '@/domain/externs/Database'
import { createMessageStore, type MessageDatabaseSchema } from '@/domain/MessageStore'
import { ChatRoom, type ChatRoomDependencies } from '@/domain/impls/runtime/ChatRoom'
import { getSnapshot, pageDomain, pageId, server, whenAttach } from '@/domain/impls/runtime/Client'

export const createChatRoomImpl = (database: Database<MessageDatabaseSchema>) => {
  const dependencies: ChatRoomDependencies = {
    server,
    messageStore: createMessageStore(database),
    pageDomain,
    pageId,
    getSnapshot,
    whenAttach
  }

  const room = new ChatRoom(dependencies)
  return {
    value: room,
    epochSource: room
  }
}
