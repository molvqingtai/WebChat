import { Remesh } from 'remesh'
import { ListModule } from 'remesh/modules/list'
import { nanoid } from 'nanoid'
import { from, map, tap, merge } from 'rxjs'
import mem from 'mem'
import Storage from './externs/Storage'

export interface Message {
  id: string
  [key: string]: any
}

const MessageListDomain = <T extends Message>() =>
  Remesh.domain({
    name: 'MessageListDomain',
    impl: (domain) => {
      const storage = domain.getExtern(Storage)
      const storageKey = `${storage.name}.MESSAGE_LIST`

      const MessageListModule = ListModule<T>(domain, {
        name: 'MessageListModule',
        key: (message) => message.id
      })

      const ListQuery = MessageListModule.query.ItemListQuery

      const ItemQuery = MessageListModule.query.ItemQuery

      const ChangeListEvent = domain.event({
        name: 'MessageList.ChangeListEvent',
        impl: ({ get }) => {
          return get(ListQuery())
        }
      })

      const CreateItemEvent = domain.event<T>({
        name: 'MessageList.CreateItemEvent'
      })

      const CreateItemCommand = domain.command({
        name: 'MessageList.CreateItemCommand',
        impl: (_, message: Omit<T, 'id'>) => {
          const newMessage = { ...message, id: nanoid() } as T
          return [MessageListModule.command.AddItemCommand(newMessage), CreateItemEvent(newMessage), ChangeListEvent()]
        }
      })

      const UpdateItemEvent = domain.event<T>({
        name: 'MessageList.UpdateItemEvent'
      })

      const UpdateItemCommand = domain.command({
        name: 'MessageList.UpdateItemCommand',
        impl: (_, message: T) => {
          return [MessageListModule.command.UpdateItemCommand(message), UpdateItemEvent(message), ChangeListEvent()]
        }
      })

      const DeleteItemEvent = domain.event<string>({
        name: 'MessageList.DeleteItemEvent'
      })

      const DeleteItemCommand = domain.command({
        name: 'MessageList.DeleteItemCommand',
        impl: (_, id: string) => {
          return [MessageListModule.command.DeleteItemCommand(id), DeleteItemEvent(id), ChangeListEvent()]
        }
      })

      const ClearListEvent = domain.event({
        name: 'MessageList.ClearListEvent'
      })

      const ClearListCommand = domain.command({
        name: 'MessageList.ClearListCommand',
        impl: () => {
          return [MessageListModule.command.DeleteAllCommand(), ClearListEvent(), ChangeListEvent()]
        }
      })

      const InitListEvent = domain.event<T[]>({
        name: 'MessageList.InitListEvent'
      })

      const InitListCommand = domain.command({
        name: 'MessageList.InitListCommand',
        impl: (_, messages: T[]) => {
          return [MessageListModule.command.SetListCommand(messages), InitListEvent(messages)]
        }
      })

      domain.effect({
        name: 'FormStorageToStateEffect',
        impl: () => {
          return from(storage.get<T[]>(storageKey)).pipe(map((messages) => InitListCommand(messages ?? [])))
        }
      })

      domain.effect({
        name: 'FormStateToStorageEffect',
        impl: ({ fromEvent }) => {
          const createItem$ = fromEvent(ChangeListEvent).pipe(
            tap(async (messages) => await storage.set<T[]>(storageKey, messages))
          )
          return merge(createItem$).pipe(map(() => null))
        }
      })

      return {
        query: {
          ItemQuery,
          ListQuery
        },
        command: {
          CreateItemCommand,
          UpdateItemCommand,
          DeleteItemCommand,
          ClearListCommand
        },
        event: {
          CreateItemEvent,
          UpdateItemEvent,
          DeleteItemEvent,
          ClearListEvent
        }
      }
    }
  })()

export default mem(MessageListDomain)
