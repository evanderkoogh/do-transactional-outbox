import { OutboxManager, TOB_DurableObject, withTransactionalOutbox } from '../../src'

export interface Env {
  TEST_DO_TOB: DurableObjectNamespace
  OUTBOX_MANAGER: OutboxManager
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname
    if (pathname === '/favicon.ico') {
      return new Response('Not found.', { status: 404 })
    } else {
      const id = env.TEST_DO_TOB.idFromName('test1')
      const stub = env.TEST_DO_TOB.get(id)
      return stub.fetch(request)
    }
  },
}

class TestDO implements TOB_DurableObject {
  private storage: DurableObjectStorage
  constructor(state: DurableObjectState, protected readonly env: Env) {
    this.storage = state.storage
  }

  async sendMessages(messages: { id: string; msg: any }[]): Promise<void> {
    Object.entries(messages).forEach(async ([key, msg]) => {
      await this.storage.put(`__msg::${key}`, msg)
    })
  }

  async processFetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname
    if (pathname === '/status') {
      const list = await this.storage.list()
      const db = [...list.entries()]
      const obj = { currentTime: Date.now(), db }
      return new Response(JSON.stringify(obj, null, 2), { headers: { 'content-type': 'application/json' } })
    } else if (pathname === '/execute') {
      const storage = this.env.OUTBOX_MANAGER
      await storage.put(`one`, 'first', 'first')
      const puts = {
        two: 'second',
        three: 'third',
      }
      await storage.put(puts, { type: 'multiples', blah: true })
      return new Response('Ok', { status: 200 })
    } else if (pathname === '/delete') {
      this.storage.deleteAll()
      return new Response('All gone.. ')
    } else {
      return new Response('Not Found', { status: 404 })
    }
  }

  async fetch(request: Request): Promise<Response> {
    try {
      return this.processFetch(request)
    } catch (err) {
      return new Response(JSON.stringify(err), { status: 500 })
    }
  }
}

const Test_DO = withTransactionalOutbox(TestDO)

export { Test_DO }
