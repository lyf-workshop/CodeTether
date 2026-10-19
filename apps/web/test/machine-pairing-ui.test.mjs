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
  assert.match(page, /添加设备/u)
  assert.match(dialog, /data-machine-pairing-step="entry"/u)
  assert.match(dialog, /data-machine-pairing-step="confirmation"/u)
  assert.match(dialog, /runtime\.beginRemoteMachinePairing/u)
  assert.match(dialog, /runtime\.confirmRemoteMachinePairing/u)
  assert.match(dialog, /runtime\.cancelRemoteMachinePairing/u)
  assert.match(dialog, /信任这台电脑/u)
  assert.match(dialog, /candidate\.verificationCode/u)
  assert.match(dialog, /data-machine-pairing-step="success"/u)
  assert.match(dialog, /电脑已连接/u)
  assert.match(dialog, /添加这台电脑上的项目/u)
  assert.match(dialog, /打开项目/u)
  assert.match(dialog, /查看电脑/u)
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

test('remote rows show bounded project data without triggering Provider detection', async () => {
  const [page, providers, query, runtime] = await Promise.all([
    source('components/machines/machines-page.tsx'),
    source('components/machines/machine-providers-section.tsx'),
    source('runtime/host/machine-query.ts'),
    source('runtime/host/host-runtime.ts'),
  ])
  assert.match(page, /queries: machines\.map/u)
  assert.match(page, /MachineProjectsSection/u)
  assert.match(page, /detail\.projects/u)
  assert.match(page, /machineConnectionStateLabel/u)
  assert.match(page, /lastSeenAt/u)
  assert.match(providers, /discovery\.state !== 'not_observed'/u)
  assert.match(providers, /discovery\?\.state === 'current'/u)
  assert.match(providers, /上次已知的状态/u)
  assert.doesNotMatch(
    page,
    /refreshMachineProviders|refetchInterval|setInterval/u,
  )
  assert.match(query, /invalidateMachineQueries/u)
  assert.match(runtime, /event\.type === 'machine\.updated'/u)
  assert.match(runtime, /invalidateMachineQueries\(this\.#queryClient\)/u)
})

test('remote detail is truthful and unpair remains explicit and remote-only', async () => {
  const [detail, providers, unpair, addressDialog] = await Promise.all([
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/machine-providers-section.tsx'),
    source('components/machines/unpair-machine-dialog.tsx'),
    source('components/machines/update-machine-address-dialog.tsx'),
  ])
  assert.match(
    detail,
    /machine\.kind === 'remote' && connection === undefined/u,
  )
  assert.match(detail, /<MachineProvidersSection/u)
  assert.match(detail, /runtime\.refreshMachineProviders/u)
  assert.match(providers, /重新检测/u)
  assert.match(providers, /aria-describedby/u)
  assert.match(providers, /设备连接恢复后才能重新检测/u)
  assert.match(providers, /const installationLabel =/u)
  for (const field of [
    'providerLifecycleForMachine',
    'providerLifecyclePresentation',
    'providerExecutionHealthPresentation',
    'remoteProviderCapabilitySummary',
    'capabilities.fileRead',
    'capabilities.search',
    'capabilities.toolEvents',
    'capabilities.reasoningControl',
  ])
    assert.ok(providers.includes(field))
  for (const label of ['安装状态', '运行时', '后端', '执行状态', '已声明能力'])
    assert.ok(providers.includes(label))
  assert.match(providers, /health\.freshnessLabel/u)
  assert.match(providers, /尚未提供会话所需的远程能力/u)
  assert.match(detail, /providerDiscovery/u)
  assert.match(providers, /current/u)
  assert.match(providers, /not_observed/u)
  assert.match(providers, /显示的是上次已知的状态/u)
  assert.match(detail, /connection\.currentEndpoint/u)
  assert.match(detail, /connection\.lastSuccessfulAt/u)
  assert.match(detail, /connection\.lastAttemptAt/u)
  assert.match(
    sourceSection(
      detail,
      'function MachineConnectionSection',
      'function MachineMetadata',
    ),
    /runtime\.retryMachineConnection/u,
  )
  assert.match(detail, /更新地址/u)
  assert.match(detail, /hostConnectionState === 'reconnecting'/u)
  assert.match(detail, /hostReady = hostConnectionState === 'connected'/u)
  assert.match(detail, /!hostReady/u)
  assert.match(detail, /<UnpairMachineDialog/u)
  assert.match(detail, /<UpdateMachineAddressDialog/u)
  assert.match(
    detail,
    /<MachineProjectsSection\s+machine=\{machine\}\s+projects=\{projects\}/u,
  )
  assert.match(detail, /<MachineConversationsSection/u)
  assert.match(detail, /conversations=\{conversations\}/u)
  assert.doesNotMatch(
    detail,
    /AddProjectLocationDialog|RemoveProjectLocationDialog|setExecutionTransport/u,
  )
  assert.match(unpair, /if \(machine\.kind !== 'remote'\) return null/u)
  assert.match(unpair, /runtime\.unpairMachine/u)
  assert.match(unpair, /unpairMachinePreflight/u)
  assert.match(unpair, /知道了/u)
  assert.match(unpair, /不会删除设备上的文件/u)
  assert.match(unpair, /保留设备和信任记录/u)
  assert.match(unpair, /暂时不能取消配对/u)
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
  const [dialog, providerSelection, machineSelection] = await Promise.all([
    source('components/conversations/new-conversation-dialog.tsx'),
    source('components/conversations/new-conversation-provider-selection.ts'),
    source('components/conversations/new-conversation-machine-selection.ts'),
  ])

  assert.match(machineSelection, /machine\.capabilities\.projectAccess/u)
  assert.match(dialog, /selectNewConversationMachine/u)
  assert.match(machineSelection, /machine\.capabilities\.providerExecution/u)
  assert.match(dialog, /projectLocationForMachine/u)
  assert.match(dialog, /executableConversationProviders/u)
  assert.match(
    providerSelection,
    /provider\.available[\s\S]*provider\.capabilities\.streaming[\s\S]*provider\.capabilities\.resume/u,
  )
  assert.match(dialog, /当前智能体检测或安全执行条件/u)
  assert.doesNotMatch(dialog, /当前 Codex 检测/u)
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
