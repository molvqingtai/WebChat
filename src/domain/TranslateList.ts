import { Remesh } from 'remesh'
import { ListModule } from 'remesh/modules/list'
import { IndexDBStorageExtern } from '@/domain/externs/Storage'
import StorageEffect from '@/domain/modules/StorageEffect'
import StatusModule from './modules/Status'
import { TRANSLATE_LIST_STORAGE_KEY } from '@/constants/config'
import MessageListDomain from './MessageList'
import TaskModule from './modules/Task'
import { TranslatorExtern } from './externs/Translator'
import { map, merge } from 'rxjs'

export type Translate = {
  id: string
  sourceLanguage: string
  targetLanguage: string
  sourceBody: string
  targetBody: string
}

const TranslateListDomain = Remesh.domain({
  name: 'TranslateListDomain',
  impl: (domain) => {
    const translatorExtern = domain.getExtern(TranslatorExtern)

    const storageEffect = new StorageEffect({
      domain,
      extern: IndexDBStorageExtern,
      key: TRANSLATE_LIST_STORAGE_KEY
    })

    const MessageListModule = domain.getDomain(MessageListDomain())

    const TranslateTaskModule = TaskModule(domain, {
      name: 'TranslateList.TaskModule',
      includeAsyncTime: true
    })

    const TranslateListModule = ListModule<Translate>(domain, {
      name: 'TranslateList.ListModule',
      key: (message) => message.id
    })

    const LoadStatusModule = StatusModule(domain, {
      name: 'TranslateList.LoadStatusModule'
    })

    const ListQuery = TranslateListModule.query.ItemListQuery

    const ItemQuery = domain.query({
      name: 'TranslateList.ItemQuery',
      impl: ({ get }, id: string) => {
        return get(TranslateListModule.query.HasItemByKeyQuery(id))
          ? get(TranslateListModule.query.ItemQuery(id))
          : null
      }
    })

    const HasQuery = TranslateListModule.query.HasItemByKeyQuery

    const LoadIsFinishedQuery = LoadStatusModule.query.IsFinishedQuery

    const TaskQuery = TranslateTaskModule.query.TaskQuery

    const TranslateCommand = domain.command({
      name: 'TranslateList.TranslateCommand',
      impl: ({ get }, messageId: string) => {
        const message = get(MessageListModule.query.ItemQuery(messageId))
        return [
          TranslateTaskModule.command.StartTaskCommand(),
          TranslateTaskModule.command.PushTaskCommand({
            id: messageId,
            run: async () => {
              const data = await translatorExtern.translate(message.body, {
                sourceLanguage: 'zh',
                targetLanguage: 'en'
              })

              return {
                id: messageId,
                sourceLanguage: 'zh',
                targetLanguage: 'en',
                sourceBody: message.body,
                targetBody: data
              }
            }
          })
        ]
      }
    })

    const TranslateEvent = domain.event<string>({
      name: 'TranslateList.TranslateEvent'
    })

    const OnErrorEvent = domain.event<Error>({
      name: 'TranslateList.OnErrorEvent'
    })

    const CreateItemEvent = domain.event<Translate>({
      name: 'TranslateList.CreateItemEvent'
    })

    const CreateItemCommand = domain.command({
      name: 'TranslateList.CreateItemCommand',
      impl: (_, message: Translate) => {
        return [TranslateListModule.command.AddItemCommand(message), CreateItemEvent(message), SyncToStorageEvent()]
      }
    })

    const SyncToStorageEvent = domain.event({
      name: 'TranslateList.SyncToStorageEvent',
      impl: ({ get }) => {
        return get(ListQuery())
      }
    })

    const SyncToStateEvent = domain.event<Translate[]>({
      name: 'TranslateList.SyncToStateEvent'
    })

    const SyncToStateCommand = domain.command({
      name: 'TranslateList.SyncToStateCommand',
      impl: (_, messages: Translate[]) => {
        return [TranslateListModule.command.SetListCommand(messages), SyncToStateEvent(messages)]
      }
    })

    storageEffect
      .set(SyncToStorageEvent)
      .get<Translate[]>((value) => [SyncToStateCommand(value ?? []), LoadStatusModule.command.SetFinishedCommand()])

    domain.effect({
      name: 'TranslateList.TaskEffect',
      impl: ({ fromEvent }) => {
        const onTicker$ = fromEvent(TranslateTaskModule.event.TickEvent).pipe(
          map((data) => {
            return CreateItemCommand(data)
          })
        )

        const onError$ = fromEvent(TranslateTaskModule.event.ErrorEvent).pipe(
          map((error) => {
            return OnErrorEvent(error)
          })
        )

        return merge(onTicker$, onError$)
      }
    })

    return {
      query: {
        ItemQuery,
        ListQuery,
        HasQuery,
        TaskQuery,
        LoadIsFinishedQuery
      },
      command: {
        TranslateCommand
      },
      event: {
        OnErrorEvent,
        TranslateEvent,
        SyncToStateEvent,
        SyncToStorageEvent
      }
    }
  }
})

export default TranslateListDomain
