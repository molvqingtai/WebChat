import { Remesh } from 'remesh'
import { ListModule } from 'remesh/modules/list'
import { nanoid } from 'nanoid'
import { from, map, tap, merge } from 'rxjs'
import Storage from './externs/Storage'

const MessageListDomain = Remesh.domain({
  name: 'MessageListDomain',
  impl: (domain) => {
    const storage = domain.getExtern(Storage)
    const storageKey = `MESSAGE_LIST` as const

    const MessageListModule = ListModule<Message>(domain, {
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

    const CreateItemEvent = domain.event<Message>({
      name: 'MessageList.CreateItemEvent'
    })

    const CreateItemCommand = domain.command({
      name: 'MessageList.CreateItemCommand',
      impl: (_, message: Omit<Message, 'id'>) => {
        const newMessage = { ...message, id: nanoid() }
        return [MessageListModule.command.AddItemCommand(newMessage), CreateItemEvent(newMessage), ChangeListEvent()]
      }
    })

    const UpdateItemEvent = domain.event<Message>({
      name: 'MessageList.UpdateItemEvent'
    })

    const UpdateItemCommand = domain.command({
      name: 'MessageList.UpdateItemCommand',
      impl: (_, message: Message) => {
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

    const InitListEvent = domain.event<Message[]>({
      name: 'MessageList.InitListEvent'
    })

    const InitListCommand = domain.command({
      name: 'MessageList.InitListCommand',
      impl: (_, messages: Message[]) => {
        return [MessageListModule.command.SetListCommand(messages), InitListEvent(messages)]
      }
    })

    domain.effect({
      name: 'FormStorageToStateEffect',
      impl: () => {
        return from(storage.get<Message[]>(storageKey)).pipe(map((messages) => InitListCommand(messages ?? [])))
      }
    })

    domain.effect({
      name: 'FormStateToStorageEffect',
      impl: ({ fromEvent }) => {
        const changeList$ = fromEvent(ChangeListEvent).pipe(
          tap(async (messages) => await storage.set<Message[]>(storageKey, messages))
        )
        return merge(changeList$).pipe(map(() => null))
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
})

export default MessageListDomain
