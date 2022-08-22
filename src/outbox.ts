import { Task, TM_DurableObject, withTaskManager } from 'do-taskmanager'
import { ulidFactory } from 'ulid-workers'

export interface OutboxProcessor {
  sendMessages<M = any>(messages: { id: string; msg: M }[]): Promise<void>
}

export type TOB_DurableObject = DurableObject & OutboxProcessor

export type TOB_Env = {
  OUTBOX_MANAGER: OutboxManager
}

export interface OutboxManager {
  put<T, M = any>(key: string, value: T, msg: M, options?: DurableObjectPutOptions): Promise<void>
  put<T, M = any>(entries: Record<string, T>, msg: M, options?: DurableObjectPutOptions): Promise<void>
}

type TOB_DO_class<T extends TOB_Env> = {
  new (state: DurableObjectState, env: T, ...args: any[]): TOB_DurableObject
}

type DOPO = DurableObjectPutOptions

class OutboxManagerImpl implements OutboxManager {
  private ulid = ulidFactory()
  constructor(private storage: DurableObjectStorage, private env: any) {}
  put<T = any, M = any>(key: string, value: T, msg: M, options?: DOPO | undefined): Promise<void>
  put<T = any, M = any>(entries: Record<string, T>, msg: M, options?: DOPO | undefined): Promise<void>
  async put<T = any, M = any>(
    kOrE: string | Record<string, T>,
    vOrM: T | M,
    mOrO?: M | DOPO,
    opts?: DOPO,
  ): Promise<void> {
    const entries = typeof kOrE === 'string' ? { [kOrE]: vOrM } : kOrE
    const msg = typeof kOrE === 'string' ? mOrO : vOrM
    const options = typeof kOrE === 'string' ? opts : mOrO
    const msg_key = `__outgoing_msg::id::${this.ulid()}`
    const promises: Promise<any>[] = Object.entries(entries).map(([key, value]) => {
      return this.storage.put(key, value, options)
    })
    promises.push(this.storage.put(msg_key, msg))
    promises.push(this.env.TASK_MANAGER.scheduleTaskAt(1, 'transactional_outbox'))
    //@ts-ignore
    return Promise.all(promises)
  }
}

async function sendMsgs(tob_do: TOB_DurableObject, storage: DurableObjectStorage) {
  const list = await storage.list<any>({ prefix: '__outgoing_msg::id::' })
  const msgs = [...list].map(([id, msg]) => ({ id, msg }))
  await tob_do.sendMessages(msgs)
  const to_delete = [...list].map(([id]) => id)
  //TODO: deal with more than 128 keys
  await storage.delete(to_delete)
}

function proxyDO(targetDO: TOB_DurableObject & TM_DurableObject, storage: DurableObjectStorage): TOB_DurableObject {
  const proxy = new Proxy(targetDO, {
    get: (target, prop, receiver) => {
      if (prop === 'processTask') {
        return async (task: Task) => {
          if (task.context === 'transactional_outbox') {
            await sendMsgs(receiver, storage)
          } else {
            await target.processTask(task)
          }
        }
      } else if (prop === 'alarm') {
        return async () => {
          const taskContext = (target as any).__task_context
          if (taskContext) {
            taskContext.alarm(receiver)
          } else {
            return (target as any)[prop].bind(receiver)
          }
        }
      } else {
        const value = (target as any)[prop]
        if (typeof value === 'function') {
          value.bind(receiver)
        }
        return value
      }
    },
  })
  return proxy
}

const TOB_PROP = Symbol('hasTOB')

export function withTransactionalOutbox<T extends TOB_Env>(do_class: TOB_DO_class<T>): TOB_DO_class<T> {
  if ((do_class as any)[TOB_PROP]) {
    return do_class
  } else {
    const withTM = withTaskManager(do_class as any)
    const proxy = new Proxy(withTM, {
      construct: (target, [state, env, ...rest]) => {
        env.OUTBOX_MANAGER = new OutboxManagerImpl(state.storage, env)
        const obj = new target(state, env, ...rest)
        const proxiedDO = proxyDO(obj as any, state.storage)
        return proxiedDO
      },
      get: (target, prop) => {
        if (prop === TOB_PROP) {
          return true
        } else {
          return (target as any)[prop]
        }
      },
    })
    //@ts-ignore
    return proxy
  }
}
