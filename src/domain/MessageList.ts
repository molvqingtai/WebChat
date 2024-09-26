import { Remesh } from 'remesh'
import { ListModule } from 'remesh/modules/list'
import { IndexDBStorageExtern } from '@/domain/externs/Storage'
import StorageEffect from '@/domain/modules/StorageEffect'
import StatusModule from './modules/Status'

export enum MessageType {
  Normal = 'normal',
  Prompt = 'prompt'
}

export interface MessageUser {
  userId: string
  username: string
  userAvatar: string
}

export interface NormalMessage extends MessageUser {
  type: MessageType.Normal
  id: string
  body: string
  date: number
  likeUsers: MessageUser[]
  hateUsers: MessageUser[]
}

export interface PromptMessage extends MessageUser {
  type: MessageType.Prompt
  id: string
  body: string
  date: number
}

export type Message = NormalMessage | PromptMessage

export const STORAGE_KEY = `MESSAGE_LIST`

const MessageListDomain = Remesh.domain({
  name: 'MessageListDomain',
  impl: (domain) => {
    const storageEffect = new StorageEffect({
      domain,
      extern: IndexDBStorageExtern,
      key: STORAGE_KEY
    })

    const MessageListModule = ListModule<Message>(domain, {
      name: 'MessageListModule',
      key: (message) => message.id
    })

    const MessageListLoadStatusModule = StatusModule(domain, {
      name: 'MessageListLoadStatusModule'
    })

    const ListQuery = MessageListModule.query.ItemListQuery

    const ItemQuery = MessageListModule.query.ItemQuery

    const HasItemQuery = MessageListModule.query.HasItemByKeyQuery

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
      impl: (_, message: Message) => {
        return [
          MessageListModule.command.AddItemCommand(message),
          CreateItemEvent(message),
          ChangeListEvent(),
          SyncToStorageEvent()
        ]
      }
    })

    const UpdateItemEvent = domain.event<Message>({
      name: 'MessageList.UpdateItemEvent'
    })

    const UpdateItemCommand = domain.command({
      name: 'MessageList.UpdateItemCommand',
      impl: (_, message: Message) => {
        return [
          MessageListModule.command.UpdateItemCommand(message),
          UpdateItemEvent(message),
          ChangeListEvent(),
          SyncToStorageEvent()
        ]
      }
    })

    const DeleteItemEvent = domain.event<string>({
      name: 'MessageList.DeleteItemEvent'
    })

    const DeleteItemCommand = domain.command({
      name: 'MessageList.DeleteItemCommand',
      impl: (_, id: string) => {
        return [
          MessageListModule.command.DeleteItemCommand(id),
          DeleteItemEvent(id),
          ChangeListEvent(),
          SyncToStorageEvent()
        ]
      }
    })

    const ClearListEvent = domain.event({
      name: 'MessageList.ClearListEvent'
    })

    const ClearListCommand = domain.command({
      name: 'MessageList.ClearListCommand',
      impl: () => {
        return [MessageListModule.command.DeleteAllCommand(), ClearListEvent(), ChangeListEvent(), SyncToStorageEvent()]
      }
    })

    const SyncToStorageEvent = domain.event({
      name: 'MessageList.SyncToStorageEvent',
      impl: ({ get }) => {
        return get(ListQuery())
      }
    })

    const SyncToStateEvent = domain.event<Message[]>({
      name: 'MessageList.SyncToStateEvent'
    })

    const SyncToStateCommand = domain.command({
      name: 'MessageList.SyncToStateCommand',
      impl: (_, messages: Message[]) => {
        return [MessageListModule.command.SetListCommand(messages), SyncToStateEvent(messages)]
      }
    })

    storageEffect
      .set(SyncToStorageEvent)
      .get<Message[]>((value) => [
        SyncToStateCommand(value ?? []),
        MessageListLoadStatusModule.command.SetFinishedCommand()
      ])
      .watch<Message[]>((value) => SyncToStateCommand(value ?? []))

    return {
      query: {
        HasItemQuery,
        ItemQuery,
        ListQuery,
        MessageListLoadIsFinishedQuery: MessageListLoadStatusModule.query.IsFinishedQuery
      },
      command: {
        CreateItemCommand,
        UpdateItemCommand,
        DeleteItemCommand,
        ClearListCommand
      },
      event: {
        ChangeListEvent,
        CreateItemEvent,
        UpdateItemEvent,
        DeleteItemEvent,
        ClearListEvent,
        SyncToStateEvent,
        SyncToStorageEvent
      }
    }
  }
})

export default MessageListDomain
