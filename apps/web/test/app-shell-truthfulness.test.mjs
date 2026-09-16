import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const componentDirectory = new URL(
  '../src/components/app-shell/',
  import.meta.url,
)

test('Workspace Sidebar presents only approved global destinations', async () => {
  const [source, rootLayout] = await Promise.all([
    readFile(new URL('workspace-sidebar.tsx', componentDirectory), 'utf8'),
    readFile(new URL('root-layout.tsx', componentDirectory), 'utf8'),
  ])

  assert.doesNotMatch(source, /machinePresences|showMockMachines/u)
  assert.doesNotMatch(source, /MacBook Pro|开发服务器|树莓派设备/u)
  assert.doesNotMatch(source, /to: '\/(?:activity|agents)'/u)
  assert.match(source, /to="\/projects"/u)
  assert.match(source, /to="\/machines"/u)
  assert.match(source, /to="\/inbox"/u)
  assert.match(source, /to="\/settings"/u)
  assert.doesNotMatch(source, /agentDefinitions/u)
  assert.doesNotMatch(source, /agentProviders/u)
  assert.doesNotMatch(
    source,
    /sidebar-current-project-heading|sidebar-agents-heading/u,
  )
  assert.match(source, /label="电脑"/u)
  assert.match(source, /label="收件箱"/u)
  assert.match(source, /label="设置"/u)
  assert.match(source, />项目</u)
  assert.match(source, />新建会话</u)
  assert.doesNotMatch(source, /即将支持/u)
  assert.match(rootLayout, /'\/machines': '电脑'/u)
  assert.match(rootLayout, /label: '电脑', to: '\/machines'/u)
  assert.doesNotMatch(rootLayout, /label: '机器', to: '\/machines'/u)
})

test('Desktop shell gives ordinary routes one page-level scroll owner', async () => {
  const [styles, shell, mainContent, rootLayout, machineDetail] =
    await Promise.all([
      readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('app-shell.tsx', componentDirectory), 'utf8'),
      readFile(new URL('main-content.tsx', componentDirectory), 'utf8'),
      readFile(new URL('root-layout.tsx', componentDirectory), 'utf8'),
      readFile(
        new URL(
          '../src/components/machines/machine-detail-page.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
    ])

  assert.match(styles, /html,\s*body,\s*#root\s*\{[^}]*overflow: hidden;/su)
  assert.match(shell, /min-h-0 overflow-hidden/u)
  assert.match(mainContent, /h-full min-h-0 min-w-0 overflow-y-auto/u)
  assert.match(rootLayout, /h-dvh overflow-y-auto/u)
  assert.doesNotMatch(machineDetail, /overflow-y-auto|overflow-auto/u)
})

test('Top Bar only renders optional product controls with real handlers', async () => {
  const source = await readFile(
    new URL('top-bar.tsx', componentDirectory),
    'utf8',
  )

  assert.match(source, /onSearch === undefined \? null/u)
  assert.match(source, /onNotifications === undefined \? null/u)
  assert.match(source, /onDoctor === undefined \? null/u)
  assert.match(source, /aria-label="检查状态"/u)
  assert.match(source, /<ShieldCheck/u)
  assert.doesNotMatch(source, /label="帮助"|<CircleHelp/u)
  assert.match(
    source,
    /onProfile === undefined \|\| profile === undefined \? null/u,
  )
  assert.doesNotMatch(source, /defaultProfile|演示用户/u)
  assert.doesNotMatch(source, /未读/u)
  assert.match(source, /待处理事项/u)
  assert.doesNotMatch(source, /新建会话/u)
})

test('Conversation shell hides unsupported controls and keeps long identities bounded', async () => {
  const componentDirectory = new URL(
    '../src/components/conversation/',
    import.meta.url,
  )
  const [composer, header, chromeActions, sidebar, detail] = await Promise.all([
    readFile(new URL('composer.tsx', componentDirectory), 'utf8'),
    readFile(new URL('conversation-header.tsx', componentDirectory), 'utf8'),
    readFile(
      new URL('conversation-chrome-actions.tsx', componentDirectory),
      'utf8',
    ),
    readFile(
      new URL('../app-shell/workspace-sidebar.tsx', componentDirectory),
      'utf8',
    ),
    readFile(
      new URL('conversation-detail-page.tsx', componentDirectory),
      'utf8',
    ),
  ])

  assert.doesNotMatch(composer, /\/ 命令|@ 引用|! 终端|# 技能|附件/u)
  assert.doesNotMatch(composer, /autoFocus=/u)
  assert.doesNotMatch(composer, /conversation\.timeline\.blocks/u)
  assert.doesNotMatch(composer, /conversation\.pendingApprovals/u)
  assert.doesNotMatch(header, /停止当前会话|<Square/u)
  assert.doesNotMatch(chromeActions, /capabilities\.supportsDiff/u)
  assert.match(chromeActions, /capabilities\.supportsInterrupt/u)
  assert.match(header, /title=\{conversation\.title\}/u)
  assert.match(header, /connectionIndicator\.state !== 'connected'/u)
  assert.match(sidebar, /title=\{conversation\.title\}/u)
  assert.match(sidebar, /data-provider=\{conversation\.provider\}/u)
  assert.doesNotMatch(detail, /<ConversationRail/u)
  assert.doesNotMatch(sidebar, /删除|分享|导出|复制会话|移动会话/u)

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
  const [source, locations] = await Promise.all([
    readFile(
      new URL(
        '../src/components/projects/project-detail-page.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../src/components/projects/project-locations-section.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
  ])

  assert.doesNotMatch(source, /label="项目标识"/u)
  assert.match(source, /<ProjectLocationsSection/u)
  assert.match(locations, /compactProjectPath\(location\.rootPath\)/u)
  assert.match(locations, /projectFolderName\(location\.rootPath\)/u)
  assert.match(locations, /project\.locations\.map/u)
  assert.match(locations, /复制完整路径/u)
})
