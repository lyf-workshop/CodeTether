import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  RelayPeerIdSchema,
  RelayPeerRoleSchema,
  RelayPublicKeyFingerprintSchema,
} from '@codetether/relay-protocol'

import {
  loadRelayConfiguration,
  resolveRelayTlsConfiguration,
} from './configuration.js'
import { RelayService } from './relay-service.js'
import { restoreRelayStateBackup } from './state-backup.js'
import { RelayStateStore } from './state-store.js'

declare const __CODETETHER_RELAY_VERSION__: string | undefined

const relayBuildIdentity =
  typeof __CODETETHER_RELAY_VERSION__ === 'string'
    ? __CODETETHER_RELAY_VERSION__
    : 'development'

export async function runRelayCli(
  arguments_: readonly string[],
): Promise<void> {
  const [command, subcommand, ...rest] = arguments_
  if (command === 'serve' && subcommand !== undefined) {
    const options = parseOptions([subcommand, ...rest], ['--config'])
    await serve(required(options, '--config'))
    return
  }
  if (command === 'identity') {
    const options = parseOptions(
      subcommand === undefined ? rest : [subcommand, ...rest],
      ['--state-dir'],
    )
    const store = new RelayStateStore(required(options, '--state-dir'))
    try {
      writeSafeJson({
        buildIdentity: relayBuildIdentity,
        relayId: store.identity.relayId,
        relayFingerprint: store.identity.publicKeyFingerprint,
      })
    } finally {
      store.close()
    }
    return
  }
  if (command === 'token' && subcommand === 'create') {
    const options = parseOptions(rest, [
      '--state-dir',
      '--role',
      '--ttl-seconds',
    ])
    const role = RelayPeerRoleSchema.parse(required(options, '--role'))
    const ttlSeconds = optionalPositiveInteger(options.get('--ttl-seconds'))
    const store = new RelayStateStore(required(options, '--state-dir'))
    try {
      const grant = store.createEnrollmentGrant(role, {
        ...(ttlSeconds === undefined ? {} : { ttlMs: ttlSeconds * 1_000 }),
      })
      // This is the sole intentional disclosure of the one-time secret. The
      // Relay service and its logs never receive this command's stdout.
      process.stdout.write(`${grant.token}\n`)
      process.stderr.write(`Token reference: ${grant.tokenReference}\n`)
    } finally {
      store.close()
    }
    return
  }
  if (command === 'token' && subcommand === 'revoke') {
    const options = parseOptions(rest, ['--state-dir', '--token-reference'])
    const tokenReference = required(options, '--token-reference')
    const store = new RelayStateStore(required(options, '--state-dir'))
    try {
      writeSafeJson({
        tokenReference,
        revoked: store.revokeEnrollmentToken(tokenReference),
      })
    } finally {
      store.close()
    }
    return
  }
  if (command === 'peer' && subcommand === 'revoke') {
    const options = parseOptions(rest, [
      '--state-dir',
      '--peer-id',
      '--peer-fingerprint',
    ])
    const peerIdInput = options.get('--peer-id')
    const peerFingerprintInput = options.get('--peer-fingerprint')
    if ((peerIdInput === undefined) === (peerFingerprintInput === undefined)) {
      throw new Error(
        'Exactly one Relay peer identity selector must be provided',
      )
    }
    const store = new RelayStateStore(required(options, '--state-dir'))
    try {
      if (peerIdInput !== undefined) {
        const peerId = RelayPeerIdSchema.parse(peerIdInput)
        writeSafeJson({ peerId, revoked: store.revokePeer(peerId) })
      } else {
        const peerFingerprint =
          RelayPublicKeyFingerprintSchema.parse(peerFingerprintInput)
        writeSafeJson({
          peerFingerprint,
          revoked: store.revokePeerByFingerprint(peerFingerprint),
        })
      }
    } finally {
      store.close()
    }
    return
  }
  if (command === 'backup') {
    const options = parseOptions(
      subcommand === undefined ? rest : [subcommand, ...rest],
      ['--state-dir', '--output'],
    )
    const store = new RelayStateStore(required(options, '--state-dir'))
    try {
      const databasePath = await store.backupTo(required(options, '--output'))
      writeSafeJson({ backup: databasePath })
    } finally {
      store.close()
    }
    return
  }
  if (command === 'restore') {
    const options = parseOptions(
      subcommand === undefined ? rest : [subcommand, ...rest],
      ['--backup', '--state-dir'],
    )
    restoreRelayStateBackup(
      required(options, '--backup'),
      required(options, '--state-dir'),
    )
    writeSafeJson({ restored: true })
    return
  }
  throw new Error(
    'Usage: codetether-relay serve --config <absolute path> | identity --state-dir <absolute path> | token create --state-dir <absolute path> --role <controller|node> [--ttl-seconds <n>] | token revoke --state-dir <absolute path> --token-reference <id> | peer revoke --state-dir <absolute path> (--peer-id <id> | --peer-fingerprint <fingerprint>) | backup --state-dir <absolute path> --output <new directory> | restore --backup <directory> --state-dir <new directory>',
  )
}

async function serve(configurationPath: string): Promise<void> {
  const configuration = loadRelayConfiguration(configurationPath)
  const store = new RelayStateStore(configuration.stateDirectory)
  let service: RelayService | undefined
  try {
    const tls = await resolveRelayTlsConfiguration(
      configuration,
      store.identity,
    )
    service = new RelayService({
      stateStore: store,
      tls,
      host: configuration.listen.host,
      port: configuration.listen.port,
      ...(configuration.management === undefined
        ? {}
        : {
            managementHost: configuration.management.host,
            managementPort: configuration.management.port,
          }),
    })
    await service.start()
    writeSafeJson({
      event: 'relay.ready',
      buildIdentity: relayBuildIdentity,
      relayId: service.relayId,
      relayFingerprint: service.relayFingerprint,
      port: service.listeningAddress?.port,
      managementPort: service.managementAddress?.port,
    })
    await waitForShutdownSignal()
  } finally {
    if (service === undefined) store.close()
    else await service.close()
  }
}

function parseOptions(
  arguments_: readonly string[],
  allowed: readonly string[],
): Map<string, string> {
  const options = new Map<string, string>()
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index]
    const value = arguments_[index + 1]
    if (
      key === undefined ||
      value === undefined ||
      !allowed.includes(key) ||
      options.has(key) ||
      !key.startsWith('--')
    ) {
      throw new Error('Relay command options are invalid')
    }
    options.set(key, value)
  }
  return options
}

function required(options: ReadonlyMap<string, string>, key: string): string {
  const value = options.get(key)
  if (value === undefined || value.length === 0) {
    throw new Error(`Required Relay option is missing: ${key}`)
  }
  return value
}

function optionalPositiveInteger(
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined
  if (!/^[1-9][0-9]{0,5}$/u.test(value)) {
    throw new Error('Relay numeric option is invalid')
  }
  return Number(value)
}

function writeSafeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

async function waitForShutdownSignal(): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    const finish = () => {
      process.off('SIGTERM', finish)
      process.off('SIGINT', finish)
      resolvePromise()
    }
    process.once('SIGTERM', finish)
    process.once('SIGINT', finish)
  })
}

async function main(): Promise<void> {
  try {
    await runRelayCli(process.argv.slice(2))
  } catch {
    process.stderr.write('CodeTether Relay command failed.\n')
    process.exitCode = 1
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main()
}
