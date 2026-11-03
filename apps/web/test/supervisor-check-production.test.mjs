import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { build } from 'vite'

test('the real production bundle excludes Supervisor diagnostics even when its flag is enabled', async () => {
  const result = await build({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    envDir: false,
    mode: 'production',
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_CODETETHER_SUPERVISOR_CHECK': JSON.stringify('1'),
    },
    logLevel: 'silent',
    build: { write: false, sourcemap: false },
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(
    (output) => output.output,
  )
  const chunks = outputs.filter((output) => output.type === 'chunk')
  assert.ok(chunks.length > 0)
  assert.ok(
    chunks.some((chunk) =>
      Object.keys(chunk.modules).some((id) => /src[\\/]main\.tsx$/u.test(id)),
    ),
  )
  assert.ok(
    chunks.every((chunk) =>
      Object.keys(chunk.modules).every(
        (id) => !/src[\\/]dev[\\/]supervisor-check/u.test(id),
      ),
    ),
  )
  const contents = outputs
    .map((output) =>
      output.type === 'chunk' ? output.code : String(output.source),
    )
    .join('\n')
  assert.doesNotMatch(
    contents,
    /\/dev\/supervisor-check|Supervisor 只读连接检查|supervisor-check-page/u,
  )
})
