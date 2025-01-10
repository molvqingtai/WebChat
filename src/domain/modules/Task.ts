import { DomainConceptName, RemeshDomainContext } from 'remesh'
import Task, { TaskRunner, TaskStatus } from '@resreq/task'
import { fromEventPattern, map, merge } from 'rxjs'

export interface TaskOptions {
  name: DomainConceptName<'TaskModule'>
  interval?: number
  includeAsyncTime?: boolean
}

const TaskModule = (domain: RemeshDomainContext, options: TaskOptions) => {
  const task = new Task({
    interval: options.interval,
    includeAsyncTime: options.includeAsyncTime
  })

  const ListState = domain.state<TaskRunner[]>({
    name: `${options.name}.TaskState`,
    default: []
  })

  const StatusState = domain.state<TaskStatus>({
    name: `${options.name}.StatusState`,
    default: task.status
  })

  const TaskQuery = domain.query({
    name: `${options.name}.TaskQuery`,
    impl: ({ get }, taskId: string) => {
      return get(ListState()).find((item) => item.id === taskId)
    }
  })

  const TaskAllQuery = domain.query({
    name: `${options.name}.TaskAllQuery`,
    impl: ({ get }) => {
      return get(ListState())
    }
  })

  const StatusQuery = domain.query({
    name: `${options.name}.StatusQuery`,
    impl: ({ get }) => {
      return get(StatusState())
    }
  })

  const UpdateListCommand = domain.command({
    name: `${options.name}.UpdateListCommand`,
    impl: (_, list: TaskRunner[]) => {
      return ListState().new(list)
    }
  })

  const UpdateStatusCommand = domain.command({
    name: `${options.name}.UpdateStatusCommand`,
    impl: (_, status: TaskStatus) => {
      return StatusState().new(status)
    }
  })

  const StartTaskCommand = domain.command({
    name: `${options.name}.StartTaskCommand`,
    impl: () => {
      task.start()
      return [StartEvent()]
    }
  })

  const StopTaskCommand = domain.command({
    name: `${options.name}.StopTaskCommand`,
    impl: () => {
      task.stop()
      return [StopEvent()]
    }
  })

  const PauseTaskCommand = domain.command({
    name: `${options.name}.PauseTaskCommand`,
    impl: () => {
      task.pause()
      return [PauseEvent()]
    }
  })

  const PushTaskCommand = domain.command({
    name: `${options.name}.PushTaskCommand`,
    impl: (_, { id, run }: { id: string; run: () => void }) => {
      task.push(id, run)
      return [PushEvent(id)]
    }
  })

  const ClearTaskCommand = domain.command({
    name: `${options.name}.ClearTaskCommand`,
    impl: () => {
      task.clear()
      return [ClearEvent()]
    }
  })

  const PushEvent = domain.event<string>({
    name: `${options.name}.PushEvent`
  })

  const StartEvent = domain.event({
    name: `${options.name}.StartEvent`
  })

  const StopEvent = domain.event({
    name: `${options.name}.StopEvent`
  })

  const PauseEvent = domain.event({
    name: `${options.name}.PauseEvent`
  })

  const TickEvent = domain.event<any>({
    name: `${options.name}.TickEvent`
  })

  const ErrorEvent = domain.event<Error>({
    name: `${options.name}.ErrorEvent`
  })

  const ChangeEvent = domain.event({
    name: `${options.name}.ChangeEvent`
  })

  const ClearEvent = domain.event({
    name: `${options.name}.ClearEvent`
  })

  const RunStartEvent = domain.event<string>({
    name: `${options.name}.RunStartEvent`
  })

  const RunPauseEvent = domain.event<string>({
    name: `${options.name}.RunPauseEvent`
  })

  const RunSuccessEvent = domain.event<{ id: string; data: any }>({
    name: `${options.name}.RunTickEvent`
  })

  const RunErrorEvent = domain.event<{ id: string; error: Error }>({
    name: `${options.name}.RunErrorEvent`
  })

  domain.effect({
    name: `${options.name}.TimerEffect`,
    impl: () => {
      const onChange$ = fromEventPattern(
        (handler) => task.on('change', handler),
        (handler) => task.off('change', handler)
      ).pipe(
        map(() => {
          return [UpdateListCommand(task.query()), UpdateStatusCommand(task.status), ChangeEvent()]
        })
      )

      const onTick$ = fromEventPattern<any>(
        (handler) => task.on('tick', handler),
        (handler) => task.off('tick', handler)
      ).pipe(
        map((data) => {
          return TickEvent(data)
        })
      )

      const onError$ = fromEventPattern<Error>(
        (handler) => task.on('error', handler),
        (handler) => task.off('error', handler)
      ).pipe(
        map((error) => {
          return ErrorEvent(error)
        })
      )

      const onRunStart$ = fromEventPattern<string>(
        (handler) => task.on('run:start', handler),
        (handler) => task.off('run:start', handler)
      ).pipe(
        map((id) => {
          return RunStartEvent(id)
        })
      )

      const onRunPause$ = fromEventPattern<string>(
        (handler) => task.on('run:pause', handler),
        (handler) => task.off('run:pause', handler)
      ).pipe(
        map((id) => {
          return RunPauseEvent(id)
        })
      )

      const onRunError$ = fromEventPattern<[string, Error]>(
        (handler) => task.on('run:error', handler),
        (handler) => task.off('run:error', handler)
      ).pipe(
        map(([string, error]) => {
          return RunErrorEvent({ id: string, error })
        })
      )

      const onRunSuccess$ = fromEventPattern<[string, any]>(
        (handler) => task.on('run:success', handler),
        (handler) => task.off('run:success', handler)
      ).pipe(
        map(([string, data]) => {
          return RunSuccessEvent({ id: string, data })
        })
      )

      return merge(onChange$, onTick$, onError$, onRunStart$, onRunPause$, onRunError$, onRunSuccess$)
    }
  })

  return {
    query: {
      TaskQuery,
      TaskAllQuery,
      StatusQuery
    },
    command: {
      PushTaskCommand,
      StartTaskCommand,
      StopTaskCommand,
      PauseTaskCommand,
      ClearTaskCommand
    },
    event: {
      PushEvent,
      StartEvent,
      StopEvent,
      PauseEvent,
      TickEvent,
      ErrorEvent,
      ChangeEvent,
      ClearEvent,
      RunStartEvent,
      RunPauseEvent,
      RunSuccessEvent,
      RunErrorEvent
    }
  }
}

export default TaskModule
