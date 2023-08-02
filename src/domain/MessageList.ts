import { Remesh } from 'remesh'
import { ListModule } from 'remesh/modules/list'
import { nanoid } from 'nanoid'

export interface Message {
  id: string
  body: string
  username: string
  avatar: string
  date: number
  likeChecked: boolean
  hateChecked: boolean
  likeCount: number
  hateCount: number
}

const MessageListDomain = Remesh.domain({
  name: 'MessageListDomain',
  impl: (domain) => {
    const MessageListModule = ListModule<Message>(domain, {
      name: 'MessageListModule',
      key: (message) => message.id
    })

    const ListQuery = MessageListModule.query.ItemListQuery

    const ItemQuery = MessageListModule.query.ItemQuery

    const ChangeEvent = domain.event({
      name: 'MessageList.ChangeEvent',
      impl: ({ get }) => {
        return get(ListQuery())
      }
    })

    const CreateEvent = domain.event({
      name: 'MessageList.CreateEvent'
    })

    const CreateCommand = domain.command({
      name: 'MessageList.CreateCommand',
      impl: (_, message: Omit<Message, 'id'>) => {
        const id = nanoid()
        return [MessageListModule.command.AddItemCommand({ ...message, id }), CreateEvent(), ChangeEvent()]
      }
    })

    const UpdateEvent = domain.event({
      name: 'MessageList.UpdateEvent'
    })

    const UpdateCommand = domain.command({
      name: 'MessageList.UpdateCommand',
      impl: (_, message: Message) => {
        return [MessageListModule.command.UpdateItemCommand(message), UpdateEvent(), ChangeEvent()]
      }
    })

    const DeleteEvent = domain.event({
      name: 'MessageList.DeleteEvent'
    })

    const DeleteCommand = domain.command({
      name: 'MessageList.DeleteCommand',
      impl: (_, id: string) => {
        return [MessageListModule.command.DeleteItemCommand(id), DeleteEvent(), ChangeEvent()]
      }
    })

    const ClearEvent = domain.event({
      name: 'MessageList.ClearEvent'
    })

    const ClearCommand = domain.command({
      name: 'MessageList.ClearCommand',
      impl: () => {
        return [MessageListModule.command.SetListCommand([]), ClearEvent(), ChangeEvent()]
      }
    })

    return {
      query: {
        ItemQuery,
        ListQuery
      },
      command: {
        CreateCommand,
        UpdateCommand,
        DeleteCommand,
        ClearCommand
      },
      event: {
        CreateEvent,
        UpdateEvent,
        DeleteEvent,
        ClearEvent
      }
    }
  }
})

export default MessageListDomain
