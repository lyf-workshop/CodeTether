import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const sourceRoot = resolve(import.meta.dirname, '../src')

test('Machines exposes one real two-step remote pairing flow', async () => {
  const [page, dialog] = await Promise.all([
    source('components/machines/machines-page.tsx'),
    source('components/machines/add-remote-machine-dialog.tsx'),
  ])

  assert.match(page, /<AddRemoteMachineDialog/u)
  assert.match(page, /添加机器/u)
  assert.match(dialog, /data-machine-pairing-step="entry"/u)
  assert.match(dialog, /data-machine-pairing-step="confirmation"/u)
  assert.match(dialog, /runtime\.beginRemoteMachinePairing/u)
  assert.match(dialog, /runtime\.confirmRemoteMachinePairing/u)
  assert.match(dialog, /runtime\.cancelRemoteMachinePairing/u)
  assert.match(dialog, /信任这台机器/u)
  assert.match(dialog, /candidate\.verificationCode/u)
  assert.match(dialog, /setPairingCode\(''\)/u)
  assert.doesNotMatch(
    dialog,
    /localStorage|sessionStorage|dangerouslySetInnerHTML/u,
  )
  assert.doesNotMatch(dialog, /candidate\.machineId/u)
})

test('pairing inputs are keyboard-oriented, bounded, and restore deliberate focus', async () => {
  const dialog = await source(
    'components/machines/add-remote-machine-dialog.tsx',
  )

  assert.match(dialog, /ref=\{addressInputRef\}/u)
  assert.match(dialog, /onOpenAutoFocus/u)
  assert.match(dialog, /confirmationHeadingRef\.current\?\.focus\(\)/u)
  assert.match(dialog, /inputMode="numeric"/u)
  assert.match(dialog, /autoComplete="one-time-code"/u)
  assert.match(dialog, /maxLength=\{6\}/u)
  assert.match(dialog, /pattern="\[0-9\]\{6\}"/u)
  assert.match(dialog, /role="alert"/u)
  assert.match(dialog, /aria-errormessage/u)
  assert.match(dialog, /showCloseButton=\{!busy\}/u)
  assert.match(dialog, /if \(busy\) return/u)
  assert.match(dialog, /max-w-lg overflow-x-hidden/u)
  assert.match(dialog, /min-w-0/u)
  assert.match(dialog, /truncate/u)
})

test('remote rows show connection truth without querying or presenting Providers', async () => {
  const [page, query, runtime] = await Promise.all([
    source('components/machines/machines-page.tsx'),
    source('runtime/host/machine-query.ts'),
    source('runtime/host/host-runtime.ts'),
  ])

  assert.match(
    page,
    /localMachines = machines\.filter\(\(machine\) => machine\.kind === 'local'\)/u,
  )
  assert.match(page, /machine\.kind === 'local' \? \(/u)
  assert.match(page, /machineConnectionStateLabel/u)
  assert.match(page, /machineConnectionBadgeVariant/u)
  assert.match(page, /最近连接/u)
  assert.match(page, /w-full sm:w-auto/u)
  assert.doesNotMatch(page, /refetchInterval|setInterval/u)
  assert.match(query, /invalidateMachineQueries/u)
  assert.match(runtime, /event\.type === 'machine\.updated'/u)
  assert.match(runtime, /invalidateMachineQueries\(this\.#queryClient\)/u)
})

test('remote detail is truthful and unpair remains explicit and remote-only', async () => {
  const [detail, unpair] = await Promise.all([
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/unpair-machine-dialog.tsx'),
  ])
  const remote = sourceSection(
    detail,
    'function RemoteMachineDetail',
    'function MachineMetadata',
  )

  assert.match(detail, /if \(machine\.kind === 'remote'\)/u)
  assert.match(remote, /远程项目、智能体、会话、终端和文件操作尚未启用/u)
  assert.match(remote, /machineConnectionStateLabel/u)
  assert.match(remote, /authentication_failed/u)
  assert.match(remote, /incompatible/u)
  assert.match(remote, /<UnpairMachineDialog/u)
  assert.doesNotMatch(
    remote,
    /providerPresentations\.map|projects\.map|conversations\.map/u,
  )

  assert.match(unpair, /if \(machine\.kind !== 'remote'\) return null/u)
  assert.match(unpair, /runtime\.unpairMachine/u)
  assert.match(unpair, /不会删除远程机器上的文件/u)
  assert.match(unpair, /<DialogTitle>取消机器配对<\/DialogTitle>/u)
  assert.match(unpair, /role="alert"/u)
  assert.match(unpair, /showCloseButton=\{!unpairMutation\.isPending\}/u)
})

test('New Conversation excludes identity-only remote Machines by canonical capabilities', async () => {
  const dialog = await source(
    'components/conversations/new-conversation-dialog.tsx',
  )

  assert.match(dialog, /machine\.capabilities\.projectAccess/u)
  assert.match(dialog, /machine\.capabilities\.providerExecution/u)
  assert.match(dialog, /projectLocationForMachine/u)
  assert.doesNotMatch(dialog, /machine\.kind === 'remote'.*available/su)
})

async function source(relativePath) {
  return await readFile(resolve(sourceRoot, relativePath), 'utf8')
}

function sourceSection(value, start, end) {
  const startIndex = value.indexOf(start)
  const endIndex = value.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `Missing source section start: ${start}`)
  assert.notEqual(endIndex, -1, `Missing source section end: ${end}`)
  return value.slice(startIndex, endIndex)
}
