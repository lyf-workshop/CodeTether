import { isAbsolute } from 'node:path'

import {
  RelayService,
  RelayStateStore,
  generateRelayPinnedTlsIdentity,
} from '../../dist/index.js'

const stateDirectory = process.argv[2]
if (stateDirectory === undefined || !isAbsolute(stateDirectory)) {
  process.stderr.write(
    'Relay process fixture requires an absolute state path\n',
  )
  process.exit(2)
}

let service
try {
  const store = new RelayStateStore(stateDirectory)
  const tls = await generateRelayPinnedTlsIdentity(store.identity)
  service = new RelayService({
    stateStore: store,
    tls,
    host: '127.0.0.1',
    port: 0,
    managementPort: null,
    heartbeatIntervalMs: 100,
    heartbeatTimeoutMs: 300,
    logger: { log() {} },
  })
  await service.start()
  process.stdout.write(
    `${JSON.stringify({
      port: service.listeningAddress.port,
      relayId: service.relayId,
      relayFingerprint: service.relayFingerprint,
    })}\n`,
  )
} catch {
  process.stderr.write('Relay process fixture failed to start\n')
  process.exit(1)
}

let closing = false
async function close() {
  if (closing) return
  closing = true
  await service.close()
  process.exit(0)
}

process.on('SIGINT', () => void close())
process.on('SIGTERM', () => void close())
