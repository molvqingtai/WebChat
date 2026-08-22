import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import { registerApplier } from '@/domain/impls/runtime/Client'
import { WorldRoom } from '@/domain/impls/runtime/WorldRoom'

export const createWorldRoomImpl = () => {
  const room = new WorldRoom()
  registerApplier('world', (projection) => room.applyWorld(projection))
  return WorldRoomExtern.impl(room)
}
