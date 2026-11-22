import assert from 'node:assert/strict'
import test from 'node:test'
import { devicesAttentionBanner } from '../.tmp/test-dist/components/machines/devices-attention.js'

test('Devices has no Attention banner for an empty summary', () => {
  assert.equal(
    devicesAttentionBanner({
      totalOpen: 0,
      approvalOpen: 0,
      completedReviewOpen: 0,
      failedOpen: 0,
    }),
    undefined,
  )
})

test('Devices banner uses the existing global Attention summary', () => {
  assert.deepEqual(
    devicesAttentionBanner({
      totalOpen: 3,
      approvalOpen: 1,
      completedReviewOpen: 1,
      failedOpen: 1,
    }),
    {
      title: '3 件事需要你处理',
      detail: '1 件等待批准 · 1 件待查看 · 1 件失败',
    },
  )
})
