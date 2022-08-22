# do-transactional-outbox

One of the challenges that many event-driven systems face is the fact that they have to write to the database and send out an event about it. But it is impossible (or at least very impractical) to have a database-like transaction span both a database and some sort of message bus.

The [Transactional Outbox pattern](https://microservices.io/patterns/data/transactional-outbox.html) is one way to solve this problem. By saving both the state and a message to the same database, we can use regular database transaction semantics, and we can then check the database to see if any messages need to be sent. And to retry sending them in the case of failures.

## Installation

The usual `npm install do-transaction-outbox` or `yarn add do-transactional-outbox` should do the trick

## Usage

If you wrap the export of your Durable Object with a `withTransactionalOutbox()`, a `OutboxManager` will automatically be added to your `env` Object under the key `OUTBOX_MANAGER`.

The `OutboxManager` has a `put` method with exactly the same signatures as the `DurableObjectStorage` one, except with one extra argument, which is the message to be send.

To actually send the messages you define an extra method on your Durable Object `sendMessages(messages: { id: string; msg: any }[]): Promise<void>`

A full example:
``` typescript
import { OutboxManager, TOB_DurableObject, withTransactionalOutbox } from 'do-transactional-outbox'

export interface Env {
  TEST_DO_TOB: DurableObjectNamespace
  OUTBOX_MANAGER: OutboxManager
}

class DO implements TOB_DurableObject {
  private storage: DurableObjectStorage
  constructor(state: DurableObjectState, protected readonly env: Env) {
    this.storage = state.storage
  }

  async sendMessages(messages: { id: string; msg: any }[]): Promise<void> {
    Object.entries(messages).forEach(async ([key, msg]) => {
      await this.storage.put(`__msg::${key}`, msg)
    })
  }
  
  async fetch(request: Request): Promise<Response> {
    const storage = this.env.OUTBOX_MANAGER
    await storage.put(`one`, 'first', 'first')
    const puts = {
      two: 'second',
      three: 'third',
    }
    await storage.put(puts, { type: 'multiples', blah: true })
    return new Response('Ok', { status: 200 })
  }
}

const exportedDO = withTransactionalOutbox(TestDO)

export { exportedDO }

```
