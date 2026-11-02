import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const sourceRoot = resolve(import.meta.dirname, '../src')

test('device entrances open the canonical wizard, onboarding shares its pairing actions', async () => {
  const [page, dialog, hook, flow, steps, wizard] = await Promise.all([
    source('components/machines/machines-page.tsx'),
    source('components/machines/add-remote-machine-dialog.tsx'),
    source('components/machines/use-remote-machine-pairing.ts'),
    source('components/machines/machine-trust-flow.ts'),
    source('components/machines/machine-pairing-steps.tsx'),
    source('components/machines/node-pairing-page.tsx'),
  ])
  assert.match(page, /navigate\(\{ to: '\/add' \}\)/u)
  assert.match(page, /添加设备/u)
  assert.match(dialog, /useRemoteMachinePairing/u)
  assert.match(wizard, /useRemoteMachinePairing/u)
  for (const operation of [
    'beginRemoteMachinePairing',
    'confirmRemoteMachinePairing',
    'cancelRemoteMachinePairing',
  ])
    assert.ok(flow.includes(operation))
  for (const state of ['entry', 'confirmation', 'success'])
    assert.ok(steps.includes('data-machine-pairing-step="' + state + '"'))
  assert.match(steps, /candidate\.verificationCode/u)
  assert.match(steps, /验证码一致，确认配对/u)
  assert.match(steps, /已配对不等于可以执行/u)
  assert.match(wizard, /fixedMachineId=\{pairing\.pairedMachine\.machineId\}/u)
  assert.match(hook, /setPairingCode\(''\)/u)
  for (const value of [dialog, hook, flow, wizard])
    assert.doesNotMatch(
      value,
      /localStorage|sessionStorage|dangerouslySetInnerHTML/u,
    )
  assert.doesNotMatch(steps, /candidate\.machineId/u)
})

test('shared pairing inputs preserve keyboard, bounded one-time code and deliberate focus', async () => {
  const [dialog, steps, hook, wizard] = await Promise.all([
    source('components/machines/add-remote-machine-dialog.tsx'),
    source('components/machines/machine-pairing-steps.tsx'),
    source('components/machines/use-remote-machine-pairing.ts'),
    source('components/machines/node-pairing-page.tsx'),
  ])
  assert.match(dialog, /addressRef=\{addressInputRef\}/u)
  assert.match(dialog, /onOpenAutoFocus/u)
  assert.match(dialog, /confirmationHeadingRef\.current\?\.focus\(\)/u)
  assert.match(steps, /inputMode="numeric"/u)
  assert.match(steps, /autoComplete="one-time-code"/u)
  assert.match(steps, /maxLength=\{6\}/u)
  assert.match(steps, /pattern="\[0-9\]\{6\}"/u)
  assert.match(steps, /aria-errormessage/u)
  assert.match(steps, /tone="err"/u)
  assert.match(steps, /min-w-0/u)
  assert.match(steps, /truncate/u)
  assert.match(dialog, /showCloseButton=\{!busy\}/u)
  assert.match(dialog, /if \(busy\) return/u)
  assert.match(dialog, /max-w-lg overflow-x-hidden/u)
  assert.match(hook, /submitted\.current/u)
  assert.match(hook, /retry: false/u)
  assert.match(wizard, /nodePairingStep/u)
  assert.match(wizard, /confirmationHeadingRef\.current\?\.focus\(\)/u)
})

test('remote rows show bounded project data without triggering Provider detection', async () => {
  const [page, providers, query, runtime] = await Promise.all([
    source('components/machines/machines-page.tsx'),
    source('components/machines/machine-providers-section.tsx'),
    source('runtime/host/machine-query.ts'),
    source('runtime/host/host-runtime.ts'),
  ])
  assert.match(page, /projectListQueryOptions/u)
  assert.doesNotMatch(page, /useQueries|machineDetailQueryOptions/u)
  assert.match(page, /MachineProjectsSection/u)
  assert.match(page, /projects=\{projectsQuery\.data\}/u)
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
  const selection = await source(
    'components/conversations/new-conversation-selection.ts',
  )
  assert.match(selection, /selectNewConversationMachine/u)
  assert.match(machineSelection, /machine\.capabilities\.providerExecution/u)
  assert.match(selection, /project\.locations\.map/u)
  assert.match(dialog, /conversationCreationProviderOptions/u)
  assert.match(
    providerSelection,
    /provider\.available[\s\S]*provider\.capabilities\.streaming[\s\S]*provider\.capabilities\.resume/u,
  )
  assert.match(selection, /设备不能运行 AI 工具/u)
  assert.match(selection, /choice\.unavailableReason !== undefined/u)
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
