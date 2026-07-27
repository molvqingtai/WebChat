import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import { getSnapshot, pageId, server, whenReady } from '@/domain/impls/runtime/Client'
import { WorldRoom } from '@/domain/impls/runtime/WorldRoom'

export const createWorldRoomImpl = () => WorldRoomExtern.impl(new WorldRoom({ server, pageId, getSnapshot, whenReady }))
