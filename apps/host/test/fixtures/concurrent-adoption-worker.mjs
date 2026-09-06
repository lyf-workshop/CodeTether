import { parentPort, workerData } from 'node:worker_threads'

import { ConversationStore } from '../../dist/persistence/conversation-store.js'

if (parentPort === null) {
  throw new Error('Concurrent adoption fixture requires a Worker parent')
}

const store = ConversationStore.open({
  databasePath: workerData.databasePath,
  busyTimeoutMs: 10_000,
})

parentPort.postMessage({ type: 'ready' })
parentPort.once('message', (message) => {
  try {
    if (message !== 'start') {
      throw new Error('Concurrent adoption fixture received an invalid command')
    }
    const result = store.createOrGetAdoptedConversation(workerData.conversation)
    parentPort.postMessage({
      type: 'result',
      created: result.created,
      conversationId: result.conversation.conversationId,
    })
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    store.close()
  }
})
