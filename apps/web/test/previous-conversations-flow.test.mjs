import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const sourceDirectory = resolve(import.meta.dirname, '..', 'src')

test('Previous Conversations is a bounded explicit discovery and adoption step', async () => {
  const source = await readSource(
    'components/projects/previous-conversations-step.tsx',
  )

  assert.match(source, /runtime\.discoverProviderSessions\(/u)
  assert.match(source, /limit: 50/u)
  assert.match(source, /signal: abort\.signal/u)
  assert.match(source, /scanAbortRef\.current\?\.abort\(\)/u)
  assert.match(source, /nextCursor/u)
  assert.match(source, /加载更多/u)
  assert.match(source, /重新扫描/u)
  assert.match(source, /maximumImportSelection/u)
  assert.match(source, /providerSessionDiscoveryLimits\.maximumPageSize/u)
  assert.match(source, /selected\.size > maximumImportSelection/u)
  assert.match(source, /providerOrder/u)
  assert.match(source, /Codex/u)
  assert.match(source, /Claude Code/u)
})

test('selection stays accessible and adoption is an explicit per-candidate mutation', async () => {
  const source = await readSource(
    'components/projects/previous-conversations-step.tsx',
  )

  assert.match(source, /type="checkbox"/u)
  assert.match(source, /aria-label=\{`选择 \$\{candidate\.title\}`\}/u)
  assert.match(source, /role="status" aria-live="polite"/u)
  assert.match(source, /scanState === 'loading-more'/u)
  assert.match(source, /options\.rescan/u)
  assert.match(source, /stepRef\.current\?\.focus\(\)/u)
  assert.match(source, /candidateActivity === 'expired'/u)
  assert.match(source, /\? 'alert'/u)
  assert.match(source, /for \(const candidate of candidates\)/u)
  assert.match(source, /runtime\.adoptProviderSession\(/u)
  assert.match(source, /导入不会启动智能体/u)
  assert.match(source, /已在 CodeTether 中/u)
  assert.match(source, /会话已发生变化，请重新扫描/u)
  assert.doesNotMatch(source, /nativeSessionId/u)
})

test('double activation shares one synchronous import owner while items remain isolated', async () => {
  const source = await readSource(
    'components/projects/previous-conversations-step.tsx',
  )

  assert.match(source, /const importInFlightRef = useRef\(false\)/u)
  assert.match(source, /if \(\s*importInFlightRef\.current \|\|/u)
  assert.match(source, /importInFlightRef\.current = true/u)
  assert.match(source, /for \(const candidate of candidates\)/u)
  assert.match(source, /catch \(error\) \{/u)
  assert.match(source, /importInFlightRef\.current = false/u)
})

test('zero results stays distinct from unavailable Provider results', async () => {
  const source = await readSource(
    'components/projects/previous-conversations-step.tsx',
  )

  assert.match(source, /const hasSupportedProvider = providers\.some/u)
  assert.match(source, /candidates\.length === 0 &&\s*hasSupportedProvider/u)
  assert.match(source, /providerProblems\.length > 0/u)
  assert.match(source, /provider\.status === 'unsupported'/u)
  assert.match(source, /provider\.failureReason === 'machine_offline'/u)
  assert.match(
    source,
    /if \(!hasSupportedProvider\) return '以前的会话当前不可用。'/u,
  )
})

test('local Add Project preserves completion behavior after optional discovery', async () => {
  const source = await readSource('components/projects/add-project-dialog.tsx')

  assert.match(source, /<PreviousConversationsStep/u)
  assert.match(source, /projectId=\{createdProject\.project\.projectId\}/u)
  assert.match(source, /machineId=\{createdProject\.machineId\}/u)
  assert.match(source, /finishCreatedProject/u)
  assert.match(source, /await onProjectCreated\(project, created\)/u)
  assert.match(source, /to: '\/projects\/\$projectId'/u)
})

test('remote ProjectLocation discovery starts only after validated registration', async () => {
  const source = await readSource(
    'components/projects/add-project-location-dialog.tsx',
  )

  assert.match(source, /onSuccess: \(response\) =>/u)
  assert.match(
    source,
    /setRegisteredLocation\(\{ machineId: response\.data\.location\.machineId \}\)/u,
  )
  assert.match(source, /registeredLocation === undefined \? \(/u)
  assert.match(source, /<PreviousConversationsStep/u)
  assert.match(source, /onFinished=\{\(\) => setDialogOpen\(false\)\}/u)
})

test('the Web runtime keeps adoption identity private and invalidates durable indexes', async () => {
  const source = await readSource('runtime/host/host-runtime.ts')

  assert.match(source, /createBrowserActionId\(\)/u)
  assert.match(source, /discoveryCandidateId/u)
  assert.match(source, /this\.#client\.adoptProviderSession\(/u)
  assert.match(source, /invalidateConversationDurableQueries/u)
})

async function readSource(relativePath) {
  return await readFile(resolve(sourceDirectory, relativePath), 'utf8')
}
