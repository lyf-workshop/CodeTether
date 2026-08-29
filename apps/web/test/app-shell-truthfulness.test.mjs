import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const componentDirectory = new URL(
  '../src/components/app-shell/',
  import.meta.url,
)

test('Primary Sidebar does not present fixture Machines as live product state', async () => {
  const source = await readFile(
    new URL('primary-sidebar.tsx', componentDirectory),
    'utf8',
  )

  assert.doesNotMatch(source, /machinePresences|showMockMachines/u)
  assert.doesNotMatch(source, /MacBook Pro|开发服务器|树莓派设备/u)
  assert.doesNotMatch(source, /to: '\/(?:activity|agents|machines)'/u)
  assert.doesNotMatch(source, /agentDefinitions\.(?:claude|opencode)/u)
  assert.match(source, /其他智能体 · 即将支持/u)
})

test('Top Bar only renders optional product controls with real handlers', async () => {
  const source = await readFile(
    new URL('top-bar.tsx', componentDirectory),
    'utf8',
  )

  assert.match(source, /onSearch === undefined \? null/u)
  assert.match(source, /onNotifications === undefined \? null/u)
  assert.match(source, /onHelp === undefined \? null/u)
  assert.match(
    source,
    /onProfile === undefined \|\| profile === undefined \? null/u,
  )
  assert.doesNotMatch(source, /defaultProfile|演示用户/u)
  assert.doesNotMatch(source, /未读/u)
  assert.match(source, /待处理事项/u)
})

test('Conversation shell hides unsupported controls and keeps long identities bounded', async () => {
  const componentDirectory = new URL(
    '../src/components/conversation/',
    import.meta.url,
  )
  const [composer, header, rail] = await Promise.all([
    readFile(new URL('composer.tsx', componentDirectory), 'utf8'),
    readFile(new URL('conversation-header.tsx', componentDirectory), 'utf8'),
    readFile(new URL('conversation-rail.tsx', componentDirectory), 'utf8'),
  ])

  assert.doesNotMatch(composer, /\/ 命令|@ 引用|! 终端|# 技能|附件/u)
  assert.doesNotMatch(composer, /autoFocus=/u)
  assert.doesNotMatch(composer, /conversation\.timeline\.blocks/u)
  assert.doesNotMatch(composer, /conversation\.pendingApprovals/u)
  assert.doesNotMatch(header, /停止当前会话|<Square/u)
  assert.match(header, /<FileDiff aria-hidden="true" \/>/u)
  assert.match(header, /title=\{conversation\.title\}/u)
  assert.match(header, /connectionIndicator\.state !== 'connected'/u)
  assert.match(rail, /h-16 w-full/u)
  assert.match(rail, /title=\{conversation\.title\}/u)
  assert.match(rail, /ConversationOrganizationMenu/u)
  assert.doesNotMatch(rail, /删除|分享|导出|复制会话|移动会话/u)

  const timeline = await readFile(
    new URL('conversation-timeline.tsx', componentDirectory),
    'utf8',
  )
  assert.match(
    timeline,
    /relative min-h-0 min-w-0 overflow-hidden bg-background/u,
  )
})

test('Project detail keeps implementation identity out of its primary surface', async () => {
  const source = await readFile(
    new URL(
      '../src/components/projects/project-detail-page.tsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.doesNotMatch(source, /label="项目标识"/u)
  assert.match(source, /compactProjectPath\(project\.rootPath\)/u)
  assert.match(source, /projectFolderName\(project\.rootPath\)/u)
  assert.match(source, /复制完整路径/u)
})
