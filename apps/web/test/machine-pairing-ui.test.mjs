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

test('remote rows show bounded last-known Provider discovery without triggering detection', async () => {
  const [page, query, runtime] = await Promise.all([
    source('components/machines/machines-page.tsx'),
    source('runtime/host/machine-query.ts'),
    source('runtime/host/host-runtime.ts'),
  ])

  assert.match(page, /queries: machines\.map/u)
  assert.match(page, /machine\.kind === 'local' \? \(/u)
  assert.match(page, /detail\.providerDiscovery\?\.state === 'not_observed'/u)
  assert.match(page, /detail\.providerDiscovery\.state === 'last_known'/u)
  assert.match(page, /未检测到已安装智能体/u)
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
  const [detail, unpair, addressDialog] = await Promise.all([
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/unpair-machine-dialog.tsx'),
    source('components/machines/update-machine-address-dialog.tsx'),
  ])
  const remote = sourceSection(
    detail,
    'function RemoteMachineDetail',
    'function MachineMetadata',
  )

  assert.match(detail, /if \(machine\.kind === 'remote'\)/u)
  assert.match(remote, /可以在这台机器上注册和查看项目工作区位置/u)
  assert.match(remote, /远程智能体与会话执行仍未启用/u)
  assert.match(remote, /<RemoteMachineProvidersSection/u)
  assert.match(remote, /runtime\.refreshMachineProviders/u)
  assert.match(remote, /重新检测智能体/u)
  assert.match(remote, /aria-describedby/u)
  assert.match(remote, /远程机器在线后才能重新检测智能体/u)
  assert.match(remote, /provider\.available \? '已安装'/u)
  assert.match(remote, /已检测到 CLI；远程执行尚未启用/u)
  assert.match(remote, /providerDiscovery/u)
  assert.match(remote, /current/u)
  assert.match(remote, /last_known/u)
  assert.match(remote, /not_observed/u)
  assert.match(remote, /machineConnectionStateLabel/u)
  assert.match(remote, /authentication_failed/u)
  assert.match(remote, /recovery_required/u)
  assert.match(remote, /incompatible/u)
  assert.match(detail, /machineQuery\.data\.connection/u)
  assert.match(remote, /connection\.currentEndpoint/u)
  assert.match(remote, /connection\.lastSuccessfulAt/u)
  assert.match(remote, /connection\.lastAttemptAt/u)
  assert.match(remote, /runtime\.retryMachineConnection/u)
  assert.match(remote, /更新连接地址/u)
  assert.match(remote, /hostConnectionState === 'reconnecting'/u)
  assert.match(
    remote,
    /hostReadyForConnectionAction = hostConnectionState === 'connected'/u,
  )
  assert.match(remote, /!hostReadyForConnectionAction/u)
  assert.match(remote, /<UnpairMachineDialog/u)
  assert.match(remote, /<UpdateMachineAddressDialog/u)
  assert.match(
    remote,
    /<MachineProjectsSection machine=\{machine\} projects=\{projects\}/u,
  )
  assert.doesNotMatch(remote, /conversations\.map|Start Conversation|创建会话/u)
  assert.match(remote, /disabled=\{projects\.length > 0\}/u)

  assert.match(unpair, /if \(machine\.kind !== 'remote'\) return null/u)
  assert.match(unpair, /runtime\.unpairMachine/u)
  assert.match(unpair, /projectCount > 0/u)
  assert.match(unpair, /不会删除远程机器上的文件/u)
  assert.match(unpair, /不会假装已经远程撤销/u)
  assert.match(unpair, /<DialogTitle>取消机器配对<\/DialogTitle>/u)
  assert.match(unpair, /role="alert"/u)
  assert.match(unpair, /showCloseButton=\{!unpairMutation\.isPending\}/u)

  assert.match(addressDialog, /<DialogTitle>更新连接地址<\/DialogTitle>/u)
  assert.match(addressDialog, /runtime\.updateMachineConnectionAddress/u)
  assert.match(addressDialog, /ref=\{inputRef\}/u)
  assert.match(addressDialog, /onOpenAutoFocus/u)
  assert.match(addressDialog, /inputRef\.current\?\.select\(\)/u)
  assert.match(addressDialog, /aria-errormessage/u)
  assert.match(addressDialog, /role="alert"/u)
  assert.match(addressDialog, /showCloseButton=\{!updateMutation\.isPending\}/u)
  assert.match(addressDialog, /max-w-md overflow-x-hidden/u)
  assert.match(addressDialog, /身份不匹配时，原信任关系和当前地址保持不变/u)
  assert.doesNotMatch(
    addressDialog,
    /setQueryData|localStorage|sessionStorage|dangerouslySetInnerHTML/u,
  )
})

test('New Conversation excludes identity-only remote Machines by canonical capabilities', async () => {
  const dialog = await source(
    'components/conversations/new-conversation-dialog.tsx',
  )

  assert.match(dialog, /machine\.capabilities\.projectAccess/u)
  assert.match(dialog, /machine\.capabilities\.providerExecution/u)
  assert.match(dialog, /projectLocationForMachine/u)
  assert.match(dialog, /当前版本尚不支持在远程机器上执行智能体会话/u)
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
