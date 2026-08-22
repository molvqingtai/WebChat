import type { Database } from '@/domain/externs/Database'
import { createMessageStore, type MessageDatabaseSchema } from '@/domain/MessageStore'
import { ChatRoom, type ChatRoomDependencies } from '@/domain/impls/runtime/ChatRoom'
import { pageDomain, registerApplier, server } from '@/domain/impls/runtime/Client'

export const createChatRoomImpl = (database: Database<MessageDatabaseSchema>) => {
  const dependencies: ChatRoomDependencies = {
    server,
    messageStore: createMessageStore(database),
    pageDomain
  }

  const room = new ChatRoom(dependencies)
  // The sole document-local drain applies every pulled projection under one owner; registration
  // explicitly invalidates so this applier converges through the drain, never independently.
  registerApplier('chat', (projection) => room.applyChat(projection))
  registerApplier('persistence', (projection, context) => room.applyPersistence(projection, context))
  return {
    value: room,
    epochSource: room
  }
}
