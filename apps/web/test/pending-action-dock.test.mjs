import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createPendingActionDockModel } from '../.tmp/test-dist/components/conversation/pending-action-dock-model.js'

const approvals = [
  {
    id: 'approval_command01',
    kind: 'command',
    title: '执行命令',
    summary:
      '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command \'git status --short\'',
    requestedAt: '10:24',
    context: 'C:\\workspace\\project',
  },
  {
    id: 'approval_file01',
    kind: 'file-change',
    title: '修改文件',
    summary: 'src/example.ts',
    requestedAt: '10:25',
  },
]

test('no Approval produces no Pending Action Dock items', () => {
  assert.deepEqual(
    createPendingActionDockModel([], { enabled: true, states: {} }),
    [],
  )
})

test('one Approval preserves its exact action identity', () => {
  const [item] = createPendingActionDockModel([approvals[0]], {
    enabled: true,
    states: {},
  })

  assert.equal(item.id, 'approval_command01')
  assert.equal(item.controls.disabled, false)
})

test('multiple pending actions preserve identity and use semantic command presentation', () => {
  const model = createPendingActionDockModel(approvals, {
    enabled: true,
    states: {},
  })

  assert.deepEqual(
    model.map(({ id, title, subtitle }) => ({ id, title, subtitle })),
    [
      {
        id: 'approval_command01',
        title: 'Git 状态',
        subtitle: 'git status --short',
      },
      {
        id: 'approval_file01',
        title: '修改文件',
        subtitle: 'src/example.ts',
      },
    ],
  )
  assert.equal(model[0].contextLabel, 'workspace/project')
  assert.equal(model[0].context, 'C:\\workspace\\project')
})

test('each pending action derives mutation state only from its own approvalId', () => {
  const model = createPendingActionDockModel(approvals, {
    enabled: true,
    states: {
      approval_command01: {
        state: 'submitting',
        decision: 'accept',
      },
      approval_file01: {
        state: 'pending',
        error: '审批请求已失效',
      },
    },
  })

  assert.deepEqual(model[0].controls, {
    disabled: true,
    pending: true,
    decision: 'accept',
  })
  assert.deepEqual(model[1].controls, {
    disabled: false,
    pending: false,
    error: '审批请求已失效',
  })
})

test('long action text is bounded in the row while normalized detail remains inspectable', () => {
  const longCommand = `pnpm test --filter ${'workspace-segment-'.repeat(12)}`
  const [item] = createPendingActionDockModel([
    {
      ...approvals[0],
      summary: longCommand,
    },
  ])

  assert.equal(item.subtitle.length, 80)
  assert.equal(item.subtitle.endsWith('…'), true)
  assert.equal(item.detail, longCommand)
  assert.equal(JSON.stringify(item).includes('jsonrpc'), false)
  assert.equal(JSON.stringify(item).includes('providerRequestId'), false)
  assert.equal(item.controls.disabled, true)
})

test('Dock markup bounds long text and follows details, decline, accept keyboard order', async () => {
  const source = await readFile(
    new URL(
      '../src/components/conversation/pending-action-dock.tsx',
      import.meta.url,
    ),
    'utf8',
  )
  const details = source.indexOf('查看详情')
  const decline = source.indexOf("controller?.resolve(item.id, 'decline')")
  const accept = source.indexOf("controller?.resolve(item.id, 'accept')")

  assert.match(source, /className="[^"]*min-w-0[^"]*truncate/u)
  assert.match(source, /max-h-40/u)
  assert.match(source, /<details/u)
  assert.match(source, /getApprovalFocusTarget/u)
  assert.match(source, /restoreComposerWhenEditable/u)
  assert.match(source, /composer\.disabled \|\| composer\.readOnly/u)
  assert.ok(details >= 0 && details < decline && decline < accept)
  assert.doesNotMatch(source, /jsonrpc|providerRequestId/iu)
})
