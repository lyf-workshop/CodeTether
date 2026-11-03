import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectDiagnosticOperations } from '../.tmp/test-dist/dev/supervisor-operation-client.js'

test('Supervisor diagnostics show a partial Attention response as a successful read', async (t) => {
  let truncated = true
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    if (String(input).endsWith('/machines')) {
      return Response.json({ protocolVersion: 1, machines: [] })
    }
    assert.ok(String(input).endsWith('/operations'))
    assert.equal(JSON.parse(options.body).operation, 'attention.list')
    return Response.json({
      protocolVersion: 1,
      items: [],
      summary: {
        totalOpen: 1,
        approvalOpen: 0,
        completedReviewOpen: 1,
        failedOpen: 0,
      },
      truncated,
    })
  })
  const session = {
    sessionId: 'session_diagnostic',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    transport: 'relay',
    control: 'read',
  }
  const inspectAttention = async () => {
    const result = await inspectDiagnosticOperations(
      session,
      new AbortController().signal,
    )
    return result.measurements.find(
      (entry) => entry.operation === 'attention.list',
    )
  }
  const partial = await inspectAttention()
  assert.equal(partial.status, '成功')
  assert.equal(partial.detail, '仅返回部分待处理事项')

  truncated = false
  const complete = await inspectAttention()
  assert.equal(complete.status, '成功')
  assert.equal(complete.detail, undefined)

  truncated = 'yes'
  const malformed = await inspectAttention()
  assert.equal(malformed.status, '失败')
  assert.equal(malformed.detail, 'invalid_response')
})
